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
      try {
        final me = await _api.getMe();
        if (mounted) setState(() => _user = me);
      } catch (_) {
        await prefs.remove('auth_token');
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
      return AuthScreen(initialUrl: _apiUrl, onAuthenticated: _onAuthenticated);
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
  final Future<void> Function(String apiUrl, String token, UserProfile user) onAuthenticated;

  const AuthScreen({
    super.key,
    required this.initialUrl,
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

  bool _showEndpoint = false;
  bool _registerMode = false;
  bool _bootstrapRequired = false;
  bool _serverOnline = false;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initialUrl);
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

  Future<void> _probeServer({bool silent = false}) async {
    try {
      final svc = ApiService(baseUrl: _urlCtrl.text);
      final h = await svc.checkHealth();
      if (mounted) {
        setState(() {
          _serverOnline = true;
          _bootstrapRequired = h['bootstrap_required'] == true;
          _showEndpoint = false;
        });
        if (!silent) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('컨트롤 서버 연결이 확인되었습니다.')),
          );
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _serverOnline = false;
          _showEndpoint = true;
        });
      }
    }
  }

  Future<void> _submit() async {
    final username = _userCtrl.text.trim();
    final password = _passCtrl.text;
    if (username.isEmpty || password.isEmpty) return;

    setState(() => _loading = true);
    try {
      final svc = ApiService(baseUrl: _urlCtrl.text.trim());
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
      await widget.onAuthenticated(_urlCtrl.text.trim(), auth.$1, auth.$2);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: _bgSurface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _borderSubtle),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Row(
                            children: [
                              BrandShieldMark(size: 32),
                              SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('3004 VPN', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                    Text(
                                      'Private Network',
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: 11.5, color: _textMuted),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => setState(() => _showEndpoint = !_showEndpoint),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: _bgElevated,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: _borderSubtle),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 6,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: _serverOnline ? _accentGreen : Colors.amber,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Text('서버 설정', style: TextStyle(fontSize: 11.5, color: _textSecondary)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (_showEndpoint) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: _bgCanvas,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: _borderSubtle),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('컨트롤 서버 주소', style: TextStyle(fontSize: 11.5, color: _textSecondary)),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: _urlCtrl,
                                    style: _monoStyle.copyWith(fontSize: 12.5),
                                    decoration: const InputDecoration(
                                      isDense: true,
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                OutlinedButton(
                                  onPressed: () => _probeServer(),
                                  child: const Text('확인', style: TextStyle(fontSize: 12)),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                    if (!_bootstrapRequired)
                      Container(
                        padding: const EdgeInsets.all(3),
                        margin: const EdgeInsets.only(bottom: 16),
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
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: _textPrimary,
                        foregroundColor: _bgCanvas,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: Text(
                        _loading
                            ? '인증 중...'
                            : _bootstrapRequired
                                ? '관리자 계정 생성'
                                : (_registerMode ? '가입 및 로그인' : '계속하기'),
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
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
      _buildServersView(),
      _buildSettingsView(),
      if (widget.user.isAdmin) AdminTabView(api: widget.api),
    ];

    return Scaffold(
      appBar: AppBar(
        backgroundColor: _bgCanvas,
        surfaceTintColor: Colors.transparent,
        title: const Row(
          children: [
            BrandShieldMark(size: 24),
            SizedBox(width: 10),
            Text('3004 VPN', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: widget.onLogout,
            child: const Text('로그아웃', style: TextStyle(fontSize: 12.5, color: _textSecondary)),
          ),
        ],
      ),
      body: tabs[_navIdx],
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: _borderSubtle)),
        ),
        child: NavigationBar(
          height: 64,
          backgroundColor: _bgCanvas,
          indicatorColor: _bgElevated,
          selectedIndex: _navIdx,
          onDestinationSelected: (i) => setState(() => _navIdx = i),
          destinations: [
            const NavigationDestination(icon: Icon(Icons.shield_outlined, size: 20), label: '연결'),
            const NavigationDestination(icon: Icon(Icons.language_rounded, size: 20), label: '서버'),
            const NavigationDestination(icon: Icon(Icons.tune_rounded, size: 20), label: '설정'),
            if (widget.user.isAdmin)
              const NavigationDestination(icon: Icon(Icons.terminal_rounded, size: 20), label: '관리'),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectView() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 20),
          decoration: BoxDecoration(
            color: _bgSurface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _borderSubtle),
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
              const SizedBox(height: 28),
              GestureDetector(
                onTap: _isBusy ? null : (_isConnected ? _disconnect : () => _connect()),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: 136,
                  height: 136,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _bgElevated,
                    border: Border.all(
                      color: _isConnected ? _accentGreen.withValues(alpha: 0.7) : _borderStrong,
                      width: 1.5,
                    ),
                    boxShadow: _isConnected
                        ? [
                            BoxShadow(
                              color: _accentGreen.withValues(alpha: 0.16),
                              blurRadius: 32,
                            )
                          ]
                        : const [],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.power_settings_new_rounded,
                        size: 34,
                        color: _isConnected ? const Color(0xFF4ADE80) : _textSecondary,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _isBusy ? 'WAIT' : (_isConnected ? 'CONNECTED' : 'CONNECT'),
                        style: _monoStyle.copyWith(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: _isConnected ? const Color(0xFF4ADE80) : _textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
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
                onTap: () => setState(() => _navIdx = 1),
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
