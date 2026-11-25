import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wireguard_flutter/wireguard_flutter.dart';

import 'models/vpn_models.dart';
import 'services/api_service.dart';
import 'services/vpn_engine.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const Vpn3004App());
}

const _bgCanvas = Color(0xFF09090B);
const _bgSurface = Color(0xFF121216);
const _bgElevated = Color(0xFF18181E);
const _borderSubtle = Color(0x14FFFFFF);
const _borderStrong = Color(0x26FFFFFF);
const _accentGreen = Color(0xFF22C55E);
const _textPrimary = Color(0xFFF4F4F5);
const _textSecondary = Color(0xFFA1A1AA);
const _textMuted = Color(0xFF71717A);

const _monoStyle = TextStyle(
  fontFamily: 'monospace',
  fontFeatures: [FontFeature.tabularFigures()],
);

class Vpn3004App extends StatelessWidget {
  const Vpn3004App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '3004 VPN',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _bgCanvas,
        colorScheme: const ColorScheme.dark(
          primary: _textPrimary,
          secondary: _accentGreen,
          surface: _bgSurface,
        ),
        useMaterial3: true,
      ),
      home: const RootShell(),
    );
  }
}

class BrandShieldMark extends StatelessWidget {
  final double size;
  const BrandShieldMark({super.key, this.size = 32});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.square(size),
      painter: _ShieldPainter(),
    );
  }
}

class _ShieldPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width;
    final rrect = RRect.fromRectAndRadius(
      Rect.fromLTWH(1, 1, s - 2, s - 2),
      Radius.circular(s * 0.23),
    );
    canvas.drawRRect(rrect, Paint()..color = const Color(0xFF12141A));
    canvas.drawRRect(
      rrect,
      Paint()
        ..color = const Color(0x22FFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    final shield = Path()
      ..moveTo(s * 0.5, s * 0.21)
      ..lineTo(s * 0.26, s * 0.30)
      ..lineTo(s * 0.28, s * 0.54)
      ..lineTo(s * 0.5, s * 0.79)
      ..lineTo(s * 0.72, s * 0.54)
      ..lineTo(s * 0.74, s * 0.30)
      ..close();

    canvas.drawPath(
      shield,
      Paint()
        ..color = _textPrimary
        ..style = PaintingStyle.stroke
        ..strokeWidth = s * 0.06
        ..strokeJoin = StrokeJoin.round,
    );

    canvas.drawCircle(
      Offset(s * 0.5, s * 0.44),
      s * 0.07,
      Paint()..color = _accentGreen,
    );
    canvas.drawLine(
      Offset(s * 0.5, s * 0.49),
      Offset(s * 0.5, s * 0.62),
      Paint()
        ..color = _accentGreen
        ..strokeWidth = s * 0.06
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  final MobileVpnEngine _vpnEngine = MobileVpnEngine();
  late ApiService _api;

  bool _initializing = true;
  String _apiUrl = 'http://10.77.0.1:8000';
  String _deviceUid = '';
  String _deviceName = 'Mobile';
  UserProfile? _user;

  bool _autoReconnect = true;
  String _tunnelMode = 'full';

  @override
  void initState() {
    super.initState();
    _api = ApiService(baseUrl: _apiUrl);
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final savedUrl = prefs.getString('api_url') ?? 'http://10.77.0.1:8000';
    final savedToken = prefs.getString('auth_token');
    var uid = prefs.getString('device_uid');
    if (uid == null || uid.isEmpty) {
      final rand = Random.secure();
      final hex = List.generate(12, (_) => rand.nextInt(16).toRadixString(16)).join();
      uid = 'mob-$hex';
      await prefs.setString('device_uid', uid);
    }

    final platformLabel = (!kIsWeb && Platform.isIOS) ? 'iPhone' : 'Android';
    _apiUrl = savedUrl;
    _deviceUid = uid;
    _deviceName = prefs.getString('device_name') ?? '3004-$platformLabel';
    _autoReconnect = prefs.getBool('auto_reconnect') ?? true;
    _tunnelMode = prefs.getString('tunnel_mode') ?? 'full';
    _api = ApiService(baseUrl: _apiUrl, token: savedToken);

    if (savedToken != null && savedToken.isNotEmpty) {
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          final me = await _api.getMe();
          if (mounted) setState(() => _user = me);
          break;
        } on ApiException catch (e) {
          if (e.statusCode == 401 || e.statusCode == 403) {
            await prefs.remove('auth_token');
            break;
          }
          if (attempt == 0) {
            await Future<void>.delayed(const Duration(milliseconds: 900));
          }
        } catch (_) {
          if (attempt == 0) {
            await Future<void>.delayed(const Duration(milliseconds: 900));
          }
        }
      }
    }
    if (mounted) setState(() => _initializing = false);
  }

  Future<void> _onAuthenticated(String apiUrl, String token, UserProfile user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('api_url', apiUrl);
    await prefs.setString('auth_token', token);
    setState(() {
      _apiUrl = apiUrl;
      _api = ApiService(baseUrl: apiUrl, token: token);
      _user = user;
    });
  }

  Future<void> _logout() async {
    try {
      await _vpnEngine.stopTunnel();
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    if (mounted) setState(() => _user = null);
  }

  Future<void> _updateAutoReconnect(bool val) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('auto_reconnect', val);
    setState(() => _autoReconnect = val);
  }

  Future<void> _updateTunnelMode(String mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('tunnel_mode', mode);
    setState(() => _tunnelMode = mode);
  }

  @override
  Widget build(BuildContext context) {
    if (_initializing) {
      return const Scaffold(
        body: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    if (_user == null) {
      return AuthScreen(
        initialUrl: _apiUrl,
        autoReconnect: _autoReconnect,
        tunnelMode: _tunnelMode,
        onToggleAutoReconnect: _updateAutoReconnect,
        onChangeTunnelMode: _updateTunnelMode,
        onAuthenticated: _onAuthenticated,
      );
    }
    return MainWorkspace(
      api: _api,
      vpnEngine: _vpnEngine,
      user: _user!,
      deviceUid: _deviceUid,
      deviceName: _deviceName,
      autoReconnect: _autoReconnect,
      tunnelMode: _tunnelMode,
      onToggleAutoReconnect: _updateAutoReconnect,
      onChangeTunnelMode: _updateTunnelMode,
      onLogout: _logout,
    );
  }
}

class AuthScreen extends StatefulWidget {
  final String initialUrl;
  final bool autoReconnect;
  final String tunnelMode;
  final Future<void> Function(bool) onToggleAutoReconnect;
  final Future<void> Function(String) onChangeTunnelMode;
  final Future<void> Function(String apiUrl, String token, UserProfile user) onAuthenticated;

  const AuthScreen({
    super.key,
    required this.initialUrl,
    required this.autoReconnect,
    required this.tunnelMode,
    required this.onToggleAutoReconnect,
    required this.onChangeTunnelMode,
    required this.onAuthenticated,
  });

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  late final TextEditingController _urlCtrl;
  final TextEditingController _userCtrl = TextEditingController();
  final TextEditingController _passCtrl = TextEditingController();
  final TextEditingController _inviteCtrl = TextEditingController();

  int _step = 1;
  bool _registerMode = false;
  bool _bootstrapRequired = false;
  bool _serverOnline = false;
  bool _probing = false;
  bool _loading = false;
  String? _probeMessage;
  bool _probeIsError = false;
  (String, String, UserProfile)? _pendingAuth;
  late bool _autoReconnect;
  late String _tunnelMode;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initialUrl);
    _autoReconnect = widget.autoReconnect;
    _tunnelMode = widget.tunnelMode;
    _probeServer(silent: true);
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _userCtrl.dispose();
    _passCtrl.dispose();
    _inviteCtrl.dispose();
    super.dispose();
  }

  Future<bool> _probeServer({bool silent = false}) async {
    if (mounted) {
      setState(() {
        _probing = true;
        if (!silent) {
          _probeMessage = '서버 응답을 확인하는 중입니다...';
          _probeIsError = false;
        }
      });
    }
    final sw = Stopwatch()..start();
    try {
      final normalized = ApiService.normalizeBaseUrl(_urlCtrl.text);
      final svc = ApiService(baseUrl: normalized);
      final h = await svc.checkHealth();
      sw.stop();
      if (mounted) {
        _urlCtrl.text = normalized;
        setState(() {
          _serverOnline = true;
          _bootstrapRequired = h['bootstrap_required'] == true;
          _probeMessage = '연결 확인됨 · 응답 시간 ${max(1, sw.elapsedMilliseconds)} ms';
          _probeIsError = false;
        });
      }
      return true;
    } catch (e) {
      sw.stop();
      if (mounted) {
        setState(() {
          _serverOnline = false;
          _probeMessage = e.toString();
          _probeIsError = true;
        });
      }
      return false;
    } finally {
      if (mounted) setState(() => _probing = false);
    }
  }

  Future<void> _handleNext() async {
    if (_step == 1) {
      final ok = _serverOnline ? true : await _probeServer();
      if (ok && mounted) setState(() => _step = 2);
      return;
    }
    if (_step == 2) {
      final username = _userCtrl.text.trim();
      final password = _passCtrl.text;
      if (username.isEmpty || password.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('아이디와 비밀번호를 입력해 주세요.')),
        );
        return;
      }
      setState(() => _loading = true);
      try {
        final normalized = ApiService.normalizeBaseUrl(_urlCtrl.text);
        final svc = ApiService(baseUrl: normalized);
        late final (String, UserProfile) auth;
        if (_bootstrapRequired) {
          auth = await svc.bootstrap(username: username, password: password);
        } else if (_registerMode) {
          auth = await svc.register(
            username: username,
            password: password,
            inviteCode: _inviteCtrl.text.trim(),
          );
        } else {
          auth = await svc.login(username: username, password: password);
        }
        if (mounted) {
          setState(() {
            _pendingAuth = (normalized, auth.$1, auth.$2);
            _step = 3;
          });
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.toString())),
          );
        }
      } finally {
        if (mounted) setState(() => _loading = false);
      }
      return;
    }
    if (_step == 3 && _pendingAuth != null) {
      await widget.onAuthenticated(_pendingAuth!.$1, _pendingAuth!.$2, _pendingAuth!.$3);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.85),
            radius: 1.15,
            colors: [Color(0x337C3AED), Color(0x143B1D8A), _bgCanvas],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: const Color(0xD916161C),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0x1AFFFFFF)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x99000000), blurRadius: 36, offset: Offset(0, 18)),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // 3-step pill header matching desktop Stepper
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: const Color(0x12FFFFFF),
                          borderRadius: BorderRadius.circular(13),
                          border: Border.all(color: _borderSubtle),
                        ),
                        child: Row(
                          children: [
                            _stepPill(1, '서버 연결'),
                            _stepPill(2, '계정 인증'),
                            _stepPill(3, '시작 설정'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 22),
                      Row(
                        children: [
                          const BrandShieldMark(size: 32),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _step == 1
                                      ? '3004 VPN 시작하기'
                                      : _step == 2
                                          ? '계정 인증'
                                          : '시작 설정 완료',
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                                ),
                                Text(
                                  _step == 1
                                      ? '먼저 컨트롤 서버 주소를 확인합니다.'
                                      : _step == 2
                                          ? '발급받은 계정 또는 초대코드로 인증합니다.'
                                          : '자동 연결과 라우팅 방식을 선택하세요.',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 11.5, color: _textMuted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 220),
                        child: _step == 1
                            ? _buildStep1()
                            : _step == 2
                                ? _buildStep2()
                                : _buildStep3(),
                      ),
                      const SizedBox(height: 22),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          if (_step > 1)
                            OutlinedButton(
                              onPressed: (_loading || _probing)
                                  ? null
                                  : () => setState(() => _step -= 1),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: _textSecondary,
                                side: const BorderSide(color: _borderSubtle),
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                              child: const Text('이전', style: TextStyle(fontSize: 13)),
                            )
                          else
                            const SizedBox.shrink(),
                          FilledButton(
                            onPressed: (_loading || _probing) ? null : _handleNext,
                            style: FilledButton.styleFrom(
                              backgroundColor: _textPrimary,
                              foregroundColor: _bgCanvas,
                              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            child: Text(
                              _step == 1
                                  ? (_probing ? '확인 중...' : '다음')
                                  : _step == 2
                                      ? (_loading
                                          ? '인증 중...'
                                          : _bootstrapRequired
                                              ? '관리자 생성'
                                              : (_registerMode ? '가입 및 다음' : '로그인 및 다음'))
                                      : 'VPN 시작하기',
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _stepPill(int index, String label) {
    final active = _step == index;
    final done = _step > index;
    return Expanded(
      child: GestureDetector(
        onTap: done ? () => setState(() => _step = index) : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
          decoration: BoxDecoration(
            color: active ? const Color(0xFF2B2836) : Colors.transparent,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(
              color: active ? const Color(0x22FFFFFF) : Colors.transparent,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 18,
                height: 18,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: done
                      ? _accentGreen.withValues(alpha: 0.2)
                      : active
                          ? _textPrimary
                          : const Color(0x18FFFFFF),
                ),
                child: done
                    ? const Icon(Icons.check_rounded, size: 12, color: Color(0xFF4ADE80))
                    : Text(
                        '$index',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: active ? _bgCanvas : _textMuted,
                        ),
                      ),
              ),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                    color: active ? _textPrimary : _textMuted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStep1() {
    return Column(
      key: const ValueKey('step-1'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('컨트롤 서버 주소', style: TextStyle(fontSize: 12, color: _textSecondary)),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _urlCtrl,
                style: _monoStyle.copyWith(fontSize: 12.5),
                decoration: InputDecoration(
                  isDense: true,
                  filled: true,
                  fillColor: _bgCanvas,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(9),
                    borderSide: const BorderSide(color: _borderSubtle),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(9),
                    borderSide: const BorderSide(color: _borderStrong),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: _probing ? null : () => _probeServer(),
              style: OutlinedButton.styleFrom(
                foregroundColor: _textPrimary,
                side: const BorderSide(color: _borderStrong),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
              ),
              child: Text(_probing ? '확인 중' : '연결 확인', style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
        if (_probeMessage != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: _probeIsError
                  ? const Color(0x1AEF4444)
                  : _serverOnline
                      ? const Color(0x1822C55E)
                      : _bgCanvas,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: _probeIsError
                    ? const Color(0x55EF4444)
                    : _serverOnline
                        ? const Color(0x5522C55E)
                        : _borderSubtle,
              ),
            ),
            child: Text(
              _probeMessage!,
              style: TextStyle(
                fontSize: 12,
                color: _probeIsError
                    ? const Color(0xFFFCA5A5)
                    : _serverOnline
                        ? const Color(0xFF86EFAC)
                        : _textSecondary,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildStep2() {
    return Column(
      key: const ValueKey('step-2'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!_bootstrapRequired)
          Container(
            padding: const EdgeInsets.all(3),
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(
              color: _bgCanvas,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: _borderSubtle),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _segTab('로그인', !_registerMode, () => setState(() => _registerMode = false)),
                ),
                Expanded(
                  child: _segTab('초대코드 가입', _registerMode, () => setState(() => _registerMode = true)),
                ),
              ],
            ),
          ),
        _inputField('아이디', _userCtrl),
        const SizedBox(height: 12),
        _inputField('비밀번호', _passCtrl, obscure: true),
        if (_registerMode && !_bootstrapRequired) ...[
          const SizedBox(height: 12),
          _inputField('초대코드', _inviteCtrl, mono: true, hint: '3004-XXXX-XXXX'),
        ],
      ],
    );
  }

  Widget _buildStep3() {
    return Column(
      key: const ValueKey('step-3'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('앱 시작 시 자동 VPN 연결', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
          subtitle: const Text('실행 즉시 마지막 게이트웨이로 자동 연결', style: TextStyle(fontSize: 11.5, color: _textMuted)),
          value: _autoReconnect,
          activeThumbColor: _accentGreen,
          onChanged: (v) async {
            setState(() => _autoReconnect = v);
            await widget.onToggleAutoReconnect(v);
          },
        ),
        const Divider(color: _borderSubtle, height: 1),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('전체 트래픽 우회 (Full-Tunnel)', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
          subtitle: const Text('모든 외부 접속 시 서버 공인 IP 사용', style: TextStyle(fontSize: 11.5, color: _textMuted)),
          value: _tunnelMode == 'full',
          activeThumbColor: _accentGreen,
          onChanged: (v) async {
            final mode = v ? 'full' : 'split';
            setState(() => _tunnelMode = mode);
            await widget.onChangeTunnelMode(mode);
          },
        ),
      ],
    );
  }

  Widget _segTab(String label, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: active ? _bgElevated : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w500,
            color: active ? _textPrimary : _textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _inputField(
    String label,
    TextEditingController ctrl, {
    bool obscure = false,
    bool mono = false,
    String? hint,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 12, color: _textSecondary)),
        const SizedBox(height: 5),
        TextField(
          controller: ctrl,
          obscureText: obscure,
          style: mono ? _monoStyle.copyWith(fontSize: 13) : const TextStyle(fontSize: 13.5),
          decoration: InputDecoration(
            hintText: hint,
            isDense: true,
            filled: true,
            fillColor: _bgCanvas,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: _borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: _borderStrong),
            ),
          ),
        ),
      ],
    );
  }
}

class MainWorkspace extends StatefulWidget {
  final ApiService api;
  final MobileVpnEngine vpnEngine;
  final UserProfile user;
  final String deviceUid;
  final String deviceName;
  final bool autoReconnect;
  final String tunnelMode;
  final Future<void> Function(bool) onToggleAutoReconnect;
  final Future<void> Function(String) onChangeTunnelMode;
  final Future<void> Function() onLogout;

  const MainWorkspace({
    super.key,
    required this.api,
    required this.vpnEngine,
    required this.user,
    required this.deviceUid,
    required this.deviceName,
    required this.autoReconnect,
    required this.tunnelMode,
    required this.onToggleAutoReconnect,
    required this.onChangeTunnelMode,
    required this.onLogout,
  });

  @override
  State<MainWorkspace> createState() => _MainWorkspaceState();
}

class _MainWorkspaceState extends State<MainWorkspace> {
  int _navIdx = 0;

  List<VpnNode> _nodes = [];
  VpnNode? _selectedNode;
  final Map<String, int?> _pings = {};
  List<Map<String, dynamic>> _myDevices = [];
  bool _loadingMyDevices = false;

  bool _isConnected = false;
  bool _isBusy = false;
  ConnectSession? _session;
  String _publicIp = '—';
  DateTime? _connectedSince;
  Duration _uptime = Duration.zero;

  double _rxKbps = 0;
  double _txKbps = 0;
  int _rxBytes = 0;
  int _txBytes = 0;

  StreamSubscription<VpnStage>? _stageSub;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _stageSub = widget.vpnEngine.stageStream.listen((st) {
      if (!mounted) return;
      final conn = st == VpnStage.connected;
      setState(() {
        _isConnected = conn;
        _connectedSince = conn ? (_connectedSince ?? DateTime.now()) : null;
        if (!conn) _uptime = Duration.zero;
      });
      if (conn) _refreshIp();
    });
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
    _initData();
  }

  @override
  void dispose() {
    _stageSub?.cancel();
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _initData() async {
    await _loadNodes();
    await _loadMyDevices();
    final already = await widget.vpnEngine.checkConnected();
    if (mounted) setState(() => _isConnected = already);
    await _refreshIp();
    if (!already && widget.autoReconnect && _selectedNode != null) {
      await _connect();
    }
  }

  Future<void> _loadNodes() async {
    try {
      final list = await widget.api.listNodes();
      if (!mounted) return;
      setState(() {
        _nodes = list;
        _selectedNode ??= list.isNotEmpty ? list.first : null;
      });
      for (final n in list) {
        final ms = await widget.api.measurePingMs(n);
        if (mounted) setState(() => _pings[n.id] = ms);
      }
    } catch (_) {}
  }

  Future<void> _loadMyDevices() async {
    if (mounted) setState(() => _loadingMyDevices = true);
    try {
      final list = await widget.api.listMyDevices();
      if (mounted) setState(() => _myDevices = list);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingMyDevices = false);
    }
  }

  Future<void> _refreshIp() async {
    final ip = await widget.api.fetchPublicIp();
    if (mounted) setState(() => _publicIp = ip);
  }

  Future<void> _onTick() async {
    if (!mounted || !_isConnected || _connectedSince == null) return;
    setState(() => _uptime = DateTime.now().difference(_connectedSince!));
    if (widget.user.isAdmin && _session != null && _uptime.inSeconds % 3 == 0) {
      try {
        final ov = await widget.api.getAdminOverview();
        final devs = ov['devices'] as List<dynamic>? ?? [];
        for (final raw in devs) {
          final d = raw as Map<String, dynamic>;
          if (d['id'] == _session!.deviceId) {
            final rx = (d['rx_bytes'] as num? ?? 0).toInt();
            final tx = (d['tx_bytes'] as num? ?? 0).toInt();
            if (mounted) {
              setState(() {
                _rxKbps = max(0, (rx - _rxBytes) / 3072.0);
                _txKbps = max(0, (tx - _txBytes) / 3072.0);
                _rxBytes = rx;
                _txBytes = tx;
              });
            }
            break;
          }
        }
      } catch (_) {}
    }
  }

  Future<void> _connect([VpnNode? overrideNode]) async {
    final node = overrideNode ?? _selectedNode;
    if (node == null || _isBusy) return;
    setState(() => _isBusy = true);
    try {
      final plat = (!kIsWeb && Platform.isIOS) ? 'ios' : 'android';
      final issued = await widget.api.requestConnect(
        nodeId: node.id,
        deviceUid: widget.deviceUid,
        deviceName: widget.deviceName,
        platform: plat,
        mode: widget.tunnelMode,
      );
      _session = issued;
      try {
        await widget.vpnEngine.startTunnel(issued);
        if (mounted) {
          setState(() {
            _isConnected = true;
            _connectedSince = DateTime.now();
          });
        }
        await Future<void>.delayed(const Duration(seconds: 2));
        await _refreshIp();
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('프로필이 준비되었습니다. 설정 탭에서 WireGuard 앱으로 공유할 수 있습니다.')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _disconnect() async {
    if (_isBusy) return;
    setState(() => _isBusy = true);
    try {
      await widget.vpnEngine.stopTunnel();
      if (mounted) {
        setState(() {
          _isConnected = false;
          _connectedSince = null;
          _uptime = Duration.zero;
          _rxKbps = 0;
          _txKbps = 0;
        });
      }
      await Future<void>.delayed(const Duration(seconds: 1));
      await _refreshIp();
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  String _fmtDur(Duration d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.inHours)}:${two(d.inMinutes.remainder(60))}:${two(d.inSeconds.remainder(60))}';
  }

  String _fmtBytes(int b) {
    if (b < 1024) return '$b B';
    if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    return '${(b / (1024 * 1024)).toStringAsFixed(2)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final tabs = <Widget>[
      _buildConnectView(),
      _buildMyDevicesView(),
      _buildServersView(),
      _buildSettingsView(),
      if (widget.user.isAdmin) AdminTabView(api: widget.api),
    ];

    final navLabels = <(String, IconData)>[
      ('연결', Icons.shield_outlined),
      ('기기', Icons.devices_rounded),
      ('서버', Icons.language_rounded),
      ('설정', Icons.tune_rounded),
      if (widget.user.isAdmin) ('관리', Icons.terminal_rounded),
    ];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Unified Top Navigation Header (matching Desktop v1.4)
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              decoration: const BoxDecoration(
                color: Color(0xE60E0E12),
                border: Border(bottom: BorderSide(color: _borderSubtle)),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const BrandShieldMark(size: 24),
                      const SizedBox(width: 9),
                      const Text(
                        '3004 VPN',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: -0.2),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _isBusy
                              ? const Color(0xFFF59E0B)
                              : (_isConnected ? _accentGreen : _textMuted),
                          boxShadow: _isConnected
                              ? const [BoxShadow(color: Color(0xAA22C55E), blurRadius: 8)]
                              : const [],
                        ),
                      ),
                      const Spacer(),
                      PopupMenuButton<String>(
                        color: const Color(0xFF16161C),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: const BorderSide(color: _borderStrong),
                        ),
                        onSelected: (v) {
                          if (v == 'logout') widget.onLogout();
                        },
                        itemBuilder: (_) => [
                          PopupMenuItem<String>(
                            enabled: false,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  widget.user.username,
                                  style: const TextStyle(
                                    color: _textPrimary,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  widget.user.isAdmin ? 'Administrator' : 'Member',
                                  style: const TextStyle(color: _textMuted, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          const PopupMenuDivider(height: 1),
                          const PopupMenuItem<String>(
                            value: 'logout',
                            child: Text('로그아웃', style: TextStyle(color: Color(0xFFF87171), fontSize: 13)),
                          ),
                        ],
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(5, 4, 10, 4),
                          decoration: BoxDecoration(
                            color: const Color(0x0AFFFFFF),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: _borderSubtle),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 20,
                                height: 20,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: const Color(0xFF272730),
                                  border: Border.all(color: _borderStrong),
                                ),
                                child: Text(
                                  widget.user.username.isNotEmpty
                                      ? widget.user.username[0].toUpperCase()
                                      : 'U',
                                  style: const TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w700,
                                    color: _textPrimary,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                widget.user.username,
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500,
                                  color: _textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 11),
                  // Top Segmented Pill Switcher
                  Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: const Color(0x09FFFFFF),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: _borderSubtle),
                    ),
                    child: Row(
                      children: List.generate(navLabels.length, (idx) {
                        final active = _navIdx == idx;
                        final (label, icon) = navLabels[idx];
                        return Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _navIdx = idx),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 220),
                              curve: Curves.easeOutCubic,
                              padding: const EdgeInsets.symmetric(vertical: 7),
                              decoration: BoxDecoration(
                                color: active ? const Color(0xFF24242D) : Colors.transparent,
                                borderRadius: BorderRadius.circular(7),
                                border: Border.all(
                                  color: active
                                      ? (_isConnected
                                          ? const Color(0x444ADE80)
                                          : const Color(0x1EFFFFFF))
                                      : Colors.transparent,
                                ),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    icon,
                                    size: 14,
                                    color: active ? _textPrimary : _textMuted,
                                  ),
                                  const SizedBox(width: 5),
                                  Text(
                                    label,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                                      color: active ? _textPrimary : _textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                child: KeyedSubtree(
                  key: ValueKey(_navIdx),
                  child: tabs[_navIdx],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectView() {
    final auroraColor = _isBusy
        ? const Color(0x30F59E0B)
        : (_isConnected ? const Color(0x3022C55E) : const Color(0x307C3AED));
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 20),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: _borderSubtle),
            gradient: RadialGradient(
              center: const Alignment(0, -0.7),
              radius: 1.1,
              colors: [auroraColor, _bgSurface],
            ),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: _isConnected ? _accentGreen.withValues(alpha: 0.12) : _bgCanvas,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: _isConnected ? _accentGreen.withValues(alpha: 0.35) : _borderSubtle,
                  ),
                ),
                child: Text(
                  _isBusy
                      ? '터널 협상 중'
                      : (_isConnected ? 'WireGuard 암호화 활성' : '연결 해제됨'),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: _isConnected ? const Color(0xFF4ADE80) : _textSecondary,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              _ElectricPowerButton(
                connected: _isConnected,
                connecting: _isBusy,
                onTap: _isBusy ? null : (_isConnected ? _disconnect : () => _connect()),
              ),
              const SizedBox(height: 12),
              Text(
                _isBusy
                    ? 'CONNECTING...'
                    : (_isConnected ? 'CONNECTED · 탭하여 해제' : 'DISCONNECTED · 탭하여 연결'),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.6,
                  color: _isBusy
                      ? const Color(0xFFF59E0B)
                      : (_isConnected ? const Color(0xFF4ADE80) : _textMuted),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _fmtDur(_uptime),
                style: _monoStyle.copyWith(
                  fontSize: 18,
                  color: _isConnected ? _textPrimary : _textMuted,
                ),
              ),
              const SizedBox(height: 24),
              InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: () => setState(() => _navIdx = 2),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  decoration: BoxDecoration(
                    color: _bgCanvas,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: _borderSubtle),
                  ),
                  child: Row(
                    children: [
                      _regionPill(_selectedNode?.region ?? 'KR'),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selectedNode?.name ?? '게이트웨이 선택',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                            Text(
                              _isConnected && _session != null
                                  ? '할당 ${_session!.assignedIp}'
                                  : (_selectedNode?.host ?? '—'),
                              style: _monoStyle.copyWith(fontSize: 11, color: _textMuted),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _selectedNode != null && _pings[_selectedNode!.id] != null
                            ? '${_pings[_selectedNode!.id]} ms'
                            : '—',
                        style: _monoStyle.copyWith(fontSize: 11.5, color: _textSecondary),
                      ),
                      const SizedBox(width: 4),
                      const Icon(Icons.chevron_right_rounded, size: 18, color: _textMuted),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: _bgSurface,
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: _borderSubtle),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('외부 공인 IPv4', style: TextStyle(fontSize: 11.5, color: _textMuted)),
                  const SizedBox(height: 4),
                  Text(_publicIp, style: _monoStyle.copyWith(fontSize: 15.5, fontWeight: FontWeight.w600)),
                ],
              ),
              IconButton(
                onPressed: _refreshIp,
                icon: const Icon(Icons.refresh_rounded, size: 18, color: _textSecondary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _metricBox('다운로드', '${_rxKbps.toStringAsFixed(1)} KB/s', '누적 ${_fmtBytes(_rxBytes)}'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _metricBox('업로드', '${_txKbps.toStringAsFixed(1)} KB/s', '누적 ${_fmtBytes(_txBytes)}'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildMyDevicesView() {
    String platformLabel(String raw, String name) {
      final p = raw.toLowerCase();
      final n = name.toLowerCase();
      if (p == 'macos' || n.contains('mac')) return 'macOS';
      if (p == 'windows' || n.contains('desktop-') || n.contains('win')) return 'Windows';
      if (p == 'linux' || n.contains('linux') || n.contains('ubuntu')) return 'Linux';
      if (p == 'ios' || n.contains('iphone') || n.contains('ipad')) return 'iOS';
      if (p == 'android') return 'Android';
      return '기타';
    }

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${widget.user.username} 계정의 기기', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  const Text(
                    'MacBook, Windows, Linux 및 모바일 연결 기기',
                    style: TextStyle(fontSize: 11.5, color: _textMuted),
                  ),
                ],
              ),
            ),
            TextButton.icon(
              onPressed: _loadingMyDevices ? null : _loadMyDevices,
              icon: const Icon(Icons.refresh_rounded, size: 15),
              label: Text(_loadingMyDevices ? '갱신 중' : '새로고침', style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_myDevices.isEmpty)
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: _bgSurface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _borderSubtle),
            ),
            child: Text(
              _loadingMyDevices ? '기기 목록을 불러오는 중...' : '등록된 기기가 없습니다.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: _textMuted, fontSize: 12.5),
            ),
          ),
        ..._myDevices.map((d) {
          final id = (d['id'] as num).toInt();
          final name = (d['device_name'] ?? '').toString();
          final plat = platformLabel((d['platform'] ?? '').toString(), name);
          final ip = (d['assigned_ip'] ?? '—').toString();
          final online = d['online'] == true;
          final enabled = d['enabled'] != false;
          final isCurrent = (d['device_uid'] ?? '').toString() == widget.deviceUid;
          final rx = (d['rx_bytes'] as num? ?? 0).toInt();
          final tx = (d['tx_bytes'] as num? ?? 0).toInt();
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: _bgSurface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: isCurrent ? _accentGreen.withValues(alpha: 0.45) : _borderSubtle),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _bgElevated,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: _borderSubtle),
                  ),
                  child: Text(plat, style: _monoStyle.copyWith(fontSize: 10.5, fontWeight: FontWeight.w600)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              name,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                          ),
                          if (isCurrent) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(
                                color: _accentGreen.withValues(alpha: 0.14),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text('현재 기기', style: TextStyle(fontSize: 10, color: Color(0xFF4ADE80))),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$ip · ${!enabled ? '차단됨' : (online ? '접속 중' : '대기')} · ↓${_fmtBytes(rx)} ↑${_fmtBytes(tx)}',
                        style: _monoStyle.copyWith(fontSize: 11, color: _textMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline_rounded, size: 18, color: Colors.redAccent),
                  onPressed: () async {
                    try {
                      await widget.api.deleteMyDevice(id);
                      await _loadMyDevices();
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    }
                  },
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildServersView() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('VPN 게이트웨이', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            TextButton.icon(
              onPressed: _loadNodes,
              icon: const Icon(Icons.refresh_rounded, size: 15),
              label: const Text('지연시간 재측정', style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ..._nodes.map((n) {
          final sel = _selectedNode?.id == n.id;
          final ms = _pings[n.id];
          return GestureDetector(
            onTap: () async {
              setState(() {
                _selectedNode = n;
                _navIdx = 0;
              });
              if (_isConnected) await _connect(n);
            },
            child: Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: sel ? _accentGreen.withValues(alpha: 0.06) : _bgSurface,
                borderRadius: BorderRadius.circular(11),
                border: Border.all(
                  color: sel ? _accentGreen.withValues(alpha: 0.5) : _borderSubtle,
                ),
              ),
              child: Row(
                children: [
                  _regionPill(n.region),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(n.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                        Text(n.endpoint, style: _monoStyle.copyWith(fontSize: 11, color: _textMuted)),
                      ],
                    ),
                  ),
                  Text(
                    ms != null ? '$ms ms' : '—',
                    style: _monoStyle.copyWith(fontSize: 12, color: _textSecondary),
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _buildSettingsView() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: _bgSurface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: _borderSubtle),
          ),
          child: Column(
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('앱 시작 시 자동 연결', style: TextStyle(fontSize: 13.5)),
                subtitle: const Text('실행 즉시 마지막 서버로 터널을 연결합니다.', style: TextStyle(fontSize: 11.5, color: _textMuted)),
                value: widget.autoReconnect,
                activeTrackColor: _accentGreen,
                onChanged: widget.onToggleAutoReconnect,
              ),
              const Divider(color: _borderSubtle, height: 1),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('전체 트래픽 우회 (Full-Tunnel)', style: TextStyle(fontSize: 13.5)),
                subtitle: const Text('모든 웹사이트 접속 시 서버 공인 IP를 사용합니다.', style: TextStyle(fontSize: 11.5, color: _textMuted)),
                value: widget.tunnelMode == 'full',
                activeTrackColor: _accentGreen,
                onChanged: (v) => widget.onChangeTunnelMode(v ? 'full' : 'split'),
              ),
              if (_session != null) ...[
                const Divider(color: _borderSubtle, height: 1),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('수동 WireGuard 구성 공유', style: TextStyle(fontSize: 13.5)),
                  subtitle: const Text('표준 .conf 파일을 내보내거나 공식 앱으로 전달합니다.', style: TextStyle(fontSize: 11.5, color: _textMuted)),
                  trailing: OutlinedButton(
                    onPressed: () => widget.vpnEngine.exportProfileFile(_session!),
                    child: const Text('.conf 공유', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _regionPill(String code) {
    return Container(
      width: 32,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: _bgElevated,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: _borderSubtle),
      ),
      child: Text(
        code.toUpperCase(),
        style: _monoStyle.copyWith(fontSize: 11, fontWeight: FontWeight.w700),
      ),
    );
  }

  Widget _metricBox(String label, String val, String sub) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: _bgSurface,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: _borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11.5, color: _textMuted)),
          const SizedBox(height: 6),
          Text(val, style: _monoStyle.copyWith(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Text(sub, style: _monoStyle.copyWith(fontSize: 11, color: _textMuted)),
        ],
      ),
    );
  }
}

class AdminTabView extends StatefulWidget {
  final ApiService api;
  const AdminTabView({super.key, required this.api});

  @override
  State<AdminTabView> createState() => _AdminTabViewState();
}

class _AdminTabViewState extends State<AdminTabView> {
  bool _loading = true;
  List<dynamic> _invites = [];
  List<dynamic> _devices = [];

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final ov = await widget.api.getAdminOverview();
      if (mounted) {
        setState(() {
          _invites = ov['invites'] as List<dynamic>? ?? [];
          _devices = ov['devices'] as List<dynamic>? ?? [];
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _issueInvite() async {
    final res = await widget.api.createInvite(memo: '모바일 발급', maxUses: 1);
    final code = res['code'] as String;
    await Clipboard.setData(ClipboardData(text: code));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('초대코드 복사됨: $code')),
      );
    }
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)));
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('초대코드 발행', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              OutlinedButton(
                onPressed: _issueInvite,
                child: const Text('+ 코드 생성', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ..._invites.take(5).map((raw) {
            final inv = raw as Map<String, dynamic>;
            final code = inv['code'] as String;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: _bgSurface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: _borderSubtle),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(code, style: _monoStyle.copyWith(fontWeight: FontWeight.w600)),
                  IconButton(
                    icon: const Icon(Icons.copy_rounded, size: 16, color: _textSecondary),
                    onPressed: () => Clipboard.setData(ClipboardData(text: code)),
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 20),
          const Text('클라이언트 세션 관리', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ..._devices.map((raw) {
            final d = raw as Map<String, dynamic>;
            final id = (d['id'] as num).toInt();
            final enabled = d['enabled'] as bool? ?? true;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: _bgSurface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: _borderSubtle),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${d['username']} · ${d['device_name']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        Text('${d['assigned_ip']}', style: _monoStyle.copyWith(fontSize: 11.5, color: _textMuted)),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () async {
                      await widget.api.toggleDevice(id);
                      await _refresh();
                    },
                    child: Text(enabled ? '일시차단' : '해제', style: const TextStyle(fontSize: 12)),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline_rounded, size: 18, color: Colors.redAccent),
                    onPressed: () async {
                      await widget.api.deleteDevice(id);
                      await _refresh();
                    },
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _ElectricPowerButton extends StatefulWidget {
  final bool connected;
  final bool connecting;
  final VoidCallback? onTap;

  const _ElectricPowerButton({
    required this.connected,
    required this.connecting,
    this.onTap,
  });

  @override
  State<_ElectricPowerButton> createState() => _ElectricPowerButtonState();
}

class _ElectricPowerButtonState extends State<_ElectricPowerButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final coreColor = widget.connecting
        ? const Color(0xFFFEF08A)
        : (widget.connected ? const Color(0xFFBBF7D0) : const Color(0xFFECC7FF));
    final glowColor = widget.connecting
        ? const Color(0xFFF59E0B)
        : (widget.connected ? const Color(0xFF22C55E) : const Color(0xFFAD6DFF));

    return GestureDetector(
      onTap: widget.onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 260),
        width: 176,
        height: 176,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: const RadialGradient(
            center: Alignment(0, -0.1),
            colors: [Color(0xC01C1A26), Color(0xF00C0C10), Color(0xFF09090C)],
          ),
          border: Border.all(
            color: glowColor.withValues(alpha: widget.connected || widget.connecting ? 0.62 : 0.28),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: glowColor.withValues(alpha: widget.connected || widget.connecting ? 0.28 : 0.14),
              blurRadius: 36,
              spreadRadius: 1,
            ),
            const BoxShadow(
              color: Color(0x99000000),
              blurRadius: 24,
              offset: Offset(0, 12),
            ),
          ],
        ),
        child: AnimatedBuilder(
          animation: _ctrl,
          builder: (context, _) {
            return CustomPaint(
              painter: _ElectricPowerPainter(
                phase: _ctrl.value * 2 * pi,
                coreColor: coreColor,
                glowColor: glowColor,
                energy: widget.connecting ? 1.5 : (widget.connected ? 1.15 : 0.75),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _ElectricPowerPainter extends CustomPainter {
  final double phase;
  final Color coreColor;
  final Color glowColor;
  final double energy;

  _ElectricPowerPainter({
    required this.phase,
    required this.coreColor,
    required this.glowColor,
    required this.energy,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width * 0.28;
    const startAngle = -pi / 2 + 0.52;
    const sweepAngle = 2 * pi - 1.04;

    // 1. Wide outer bloom
    final bloomPaint = Paint()
      ..color = glowColor.withValues(alpha: 0.36)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 11
      ..strokeCap = StrokeCap.round
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12);

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      sweepAngle,
      false,
      bloomPaint,
    );
    canvas.drawLine(
      Offset(center.dx, center.dy - radius * 1.12),
      Offset(center.dx, center.dy - radius * 0.12),
      bloomPaint,
    );

    // 2. Living jittered electric strands around the power arc
    for (var s = 0; s < 3; s++) {
      final strandPath = Path();
      const steps = 42;
      for (var i = 0; i <= steps; i++) {
        final t = i / steps;
        final angle = startAngle + sweepAngle * t;
        final wave = sin(t * 18 + phase * (1.4 + s * 0.45) + s * 2.1) * (1.8 * energy) +
            cos(t * 31 - phase * (2.1 + s * 0.3)) * (1.1 * energy);
        final r = radius + wave;
        final pt = Offset(center.dx + cos(angle) * r, center.dy + sin(angle) * r);
        if (i == 0) {
          strandPath.moveTo(pt.dx, pt.dy);
        } else {
          strandPath.lineTo(pt.dx, pt.dy);
        }
      }
      final strandPaint = Paint()
        ..color = (s == 0 ? coreColor : glowColor).withValues(alpha: s == 0 ? 0.95 : 0.55)
        ..style = PaintingStyle.stroke
        ..strokeWidth = s == 0 ? 2.6 : 1.3
        ..strokeCap = StrokeCap.round
        ..maskFilter = s == 0 ? null : const MaskFilter.blur(BlurStyle.normal, 2);
      canvas.drawPath(strandPath, strandPaint);
    }

    // 3. Electric vertical power stem
    final stemPath = Path();
    const stemSteps = 14;
    final yTop = center.dy - radius * 1.12;
    final yBot = center.dy - radius * 0.12;
    for (var i = 0; i <= stemSteps; i++) {
      final t = i / stemSteps;
      final y = yTop + (yBot - yTop) * t;
      final jitter = sin(t * 14 + phase * 2.3) * (1.4 * energy) * sin(t * pi);
      if (i == 0) {
        stemPath.moveTo(center.dx + jitter, y);
      } else {
        stemPath.lineTo(center.dx + jitter, y);
      }
    }
    canvas.drawPath(
      stemPath,
      Paint()
        ..color = coreColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.0
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _ElectricPowerPainter oldDelegate) =>
      oldDelegate.phase != phase ||
      oldDelegate.coreColor != coreColor ||
      oldDelegate.glowColor != glowColor ||
      oldDelegate.energy != energy;
}
