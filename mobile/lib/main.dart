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
  runApp(const Vpn3004App());
}

class Vpn3004App extends StatelessWidget {
  const Vpn3004App({super.key});

  @override
  Widget build(BuildContext context) {
    const bgDark = Color(0xFF070B14);
    const cardDark = Color(0xFF101827);
    const emerald = Color(0xFF10B981);

    return MaterialApp(
      title: '삼천포(3004) VPN',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: bgDark,
        colorScheme: const ColorScheme.dark(
          primary: emerald,
          secondary: Color(0xFF38BDF8),
          surface: cardDark,
        ),
        useMaterial3: true,
      ),
      home: const RootShell(),
    );
  }
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
        if (mounted) {
          setState(() => _user = me);
        }
      } catch (_) {
        await prefs.remove('auth_token');
      }
    }

    if (mounted) {
      setState(() => _initializing = false);
    }
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
    if (mounted) {
      setState(() => _user = null);
    }
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
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_user == null) {
      return AuthScreen(
        initialUrl: _apiUrl,
        onAuthenticated: _onAuthenticated,
      );
    }

    return MainDashboard(
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

  bool _registerMode = false;
  bool _bootstrapRequired = false;
  bool _serverReachable = false;
  bool _loading = false;
  String? _statusMsg;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initialUrl);
    _probeServer();
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _userCtrl.dispose();
    _passCtrl.dispose();
    _inviteCtrl.dispose();
    super.dispose();
  }

  Future<void> _probeServer() async {
    try {
      final svc = ApiService(baseUrl: _urlCtrl.text);
      final h = await svc.checkHealth();
      if (mounted) {
        setState(() {
          _serverReachable = true;
          _bootstrapRequired = h['bootstrap_required'] == true;
          _statusMsg = _bootstrapRequired
              ? '첫 접속 감지됨: 초기 관리자 계정을 생성해 주세요.'
              : '서버 연결 정상';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _serverReachable = false;
          _statusMsg = '서버 응답 대기 중 (주소를 확인해 주세요)';
        });
      }
    }
  }

  Future<void> _submit() async {
    final username = _userCtrl.text.trim();
    final password = _passCtrl.text;
    if (username.isEmpty || password.isEmpty) {
      setState(() => _statusMsg = '아이디와 비밀번호를 모두 입력해 주세요.');
      return;
    }

    setState(() {
      _loading = true;
      _statusMsg = null;
    });

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
        setState(() => _statusMsg = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
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
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.shield_rounded, size: 56, color: Color(0xFF10B981)),
                  const SizedBox(height: 12),
                  const Text(
                    '삼천포 3004 VPN',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '어디서든 빠르고 안전한 한국 홈 · 글로벌 클라우드 VPN',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 13),
                  ),
                  const SizedBox(height: 28),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: const Color(0xFF101827),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _urlCtrl,
                                decoration: const InputDecoration(
                                  labelText: '중앙 API 서버 주소',
                                  prefixIcon: Icon(Icons.dns_rounded, size: 20),
                                  isDense: true,
                                ),
                                onSubmitted: (_) => _probeServer(),
                              ),
                            ),
                            IconButton(
                              tooltip: '연결 확인',
                              onPressed: _probeServer,
                              icon: Icon(
                                Icons.sync_rounded,
                                color: _serverReachable
                                    ? const Color(0xFF10B981)
                                    : Colors.amber,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        if (!_bootstrapRequired)
                          SegmentedButton<bool>(
                            segments: const [
                              ButtonSegment(value: false, label: Text('로그인')),
                              ButtonSegment(value: true, label: Text('초대코드 가입')),
                            ],
                            selected: {_registerMode},
                            onSelectionChanged: (s) => setState(() => _registerMode = s.first),
                          ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: _userCtrl,
                          decoration: const InputDecoration(
                            labelText: '아이디',
                            prefixIcon: Icon(Icons.person_outline_rounded),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _passCtrl,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: '비밀번호',
                            prefixIcon: Icon(Icons.lock_outline_rounded),
                          ),
                        ),
                        if (_registerMode && !_bootstrapRequired) ...[
                          const SizedBox(height: 12),
                          TextField(
                            controller: _inviteCtrl,
                            decoration: const InputDecoration(
                              labelText: '초대코드 (예: 3004-XXXX-XXXX)',
                              prefixIcon: Icon(Icons.vpn_key_outlined),
                            ),
                          ),
                        ],
                        if (_statusMsg != null) ...[
                          const SizedBox(height: 14),
                          Text(
                            _statusMsg!,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: _serverReachable && !_loading
                                  ? const Color(0xFF38BDF8)
                                  : Colors.amberAccent,
                            ),
                          ),
                        ],
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: _loading ? null : _submit,
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 15),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: _loading
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Text(
                                  _bootstrapRequired
                                      ? '초기 관리자 계정 생성 및 시작'
                                      : (_registerMode ? '회원가입 및 바로 접속' : '로그인'),
                                  style: const TextStyle(fontWeight: FontWeight.bold),
                                ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class MainDashboard extends StatefulWidget {
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

  const MainDashboard({
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
  State<MainDashboard> createState() => _MainDashboardState();
}

class _MainDashboardState extends State<MainDashboard> {
  int _tabIndex = 0;

  List<VpnNode> _nodes = [];
  VpnNode? _selectedNode;
  final Map<String, int?> _nodePings = {};

  bool _isConnected = false;
  bool _isBusy = false;
  ConnectSession? _activeSession;
  String _publicIp = '조회 중...';
  DateTime? _connectedSince;
  Duration _uptime = Duration.zero;

  double _rxSpeedKbps = 0;
  double _txSpeedKbps = 0;
  int _totalRxBytes = 0;
  int _totalTxBytes = 0;

  StreamSubscription<VpnStage>? _stageSub;
  Timer? _ticker;
  String? _bannerMsg;

  @override
  void initState() {
    super.initState();
    _stageSub = widget.vpnEngine.stageStream.listen((stage) {
      if (!mounted) return;
      final nowConn = stage == VpnStage.connected;
      setState(() {
        _isConnected = nowConn;
        if (nowConn && _connectedSince == null) {
          _connectedSince = DateTime.now();
        } else if (!nowConn) {
          _connectedSince = null;
          _uptime = Duration.zero;
        }
      });
      if (nowConn) {
        _refreshPublicIp();
      }
    });

    _ticker = Timer.periodic(const Duration(seconds: 2), (_) => _onTick());
    _bootstrapDashboard();
  }

  @override
  void dispose() {
    _stageSub?.cancel();
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _bootstrapDashboard() async {
    await _loadNodes();
    final already = await widget.vpnEngine.checkConnected();
    if (mounted) {
      setState(() => _isConnected = already);
    }
    await _refreshPublicIp();
    if (!already && widget.autoReconnect && _selectedNode != null) {
      await _connectVpn();
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
      for (final node in list) {
        final ms = await widget.api.measurePingMs(node);
        if (mounted) {
          setState(() => _nodePings[node.id] = ms);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _bannerMsg = e.toString());
      }
    }
  }

  Future<void> _refreshPublicIp() async {
    final ip = await widget.api.fetchPublicIp();
    if (mounted) {
      setState(() => _publicIp = ip);
    }
  }

  Future<void> _onTick() async {
    if (!mounted || !_isConnected) return;
    if (_connectedSince != null) {
      setState(() => _uptime = DateTime.now().difference(_connectedSince!));
    }
    if (widget.user.isAdmin && _activeSession != null) {
      try {
        final ov = await widget.api.getAdminOverview();
        final devs = (ov['devices'] as List<dynamic>? ?? []);
        for (final raw in devs) {
          final d = raw as Map<String, dynamic>;
          if (d['id'] == _activeSession!.deviceId) {
            final rx = (d['rx_bytes'] as num? ?? 0).toInt();
            final tx = (d['tx_bytes'] as num? ?? 0).toInt();
            if (mounted) {
              setState(() {
                _rxSpeedKbps = max(0, (rx - _totalRxBytes) / 2048.0);
                _txSpeedKbps = max(0, (tx - _totalTxBytes) / 2048.0);
                _totalRxBytes = rx;
                _totalTxBytes = tx;
              });
            }
            break;
          }
        }
      } catch (_) {}
    }
  }

  Future<void> _connectVpn() async {
    final node = _selectedNode;
    if (node == null || _isBusy) return;

    setState(() {
      _isBusy = true;
      _bannerMsg = null;
    });

    try {
      final plat = (!kIsWeb && Platform.isIOS) ? 'ios' : 'android';
      final session = await widget.api.requestConnect(
        nodeId: node.id,
        deviceUid: widget.deviceUid,
        deviceName: widget.deviceName,
        platform: plat,
        mode: widget.tunnelMode,
      );
      _activeSession = session;

      try {
        await widget.vpnEngine.startTunnel(session);
        if (mounted) {
          setState(() {
            _isConnected = true;
            _connectedSince = DateTime.now();
          });
        }
        await Future<void>.delayed(const Duration(seconds: 2));
        await _refreshPublicIp();
      } catch (_) {
        // On iOS without Apple paid NetworkExtension entitlement, offer 1-tap export to WireGuard app
        if (mounted) {
          setState(() {
            _bannerMsg = '프로필이 발급되었습니다! 아래 [WireGuard 앱으로 열기]로 바로 연결할 수 있습니다.';
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _bannerMsg = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  Future<void> _disconnectVpn() async {
    if (_isBusy) return;
    setState(() => _isBusy = true);
    try {
      await widget.vpnEngine.stopTunnel();
      if (mounted) {
        setState(() {
          _isConnected = false;
          _connectedSince = null;
          _uptime = Duration.zero;
          _rxSpeedKbps = 0;
          _txSpeedKbps = 0;
        });
      }
      await Future<void>.delayed(const Duration(seconds: 1));
      await _refreshPublicIp();
    } catch (e) {
      if (mounted) {
        setState(() => _bannerMsg = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  String _formatDuration(Duration d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.inHours)}:${two(d.inMinutes.remainder(60))}:${two(d.inSeconds.remainder(60))}';
  }

  String _formatBytes(int b) {
    if (b < 1024) return '$b B';
    if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    if (b < 1024 * 1024 * 1024) return '${(b / (1024 * 1024)).toStringAsFixed(2)} MB';
    return '${(b / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  void _openNodeSelector() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF101827),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'VPN 서버 노드 선택',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              ..._nodes.map((node) {
                final ping = _nodePings[node.id];
                final selected = _selectedNode?.id == node.id;
                return ListTile(
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  tileColor: selected ? const Color(0xFF10B981).withValues(alpha: 0.14) : null,
                  leading: Text(node.countryFlag, style: const TextStyle(fontSize: 26)),
                  title: Text(node.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${node.region} · ${node.host}', style: const TextStyle(fontSize: 12)),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      ping != null ? '$ping ms' : '측정 중',
                      style: const TextStyle(color: Color(0xFF10B981), fontSize: 12),
                    ),
                  ),
                  onTap: () {
                    setState(() => _selectedNode = node);
                    Navigator.pop(ctx);
                  },
                );
              }),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: const Row(
          children: [
            Icon(Icons.shield_rounded, color: Color(0xFF10B981), size: 24),
            SizedBox(width: 8),
            Text('삼천포 3004 VPN', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '로그아웃',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout_rounded),
          ),
        ],
      ),
      body: _tabIndex == 0
          ? _buildVpnTab()
          : AdminTabView(api: widget.api),
      bottomNavigationBar: widget.user.isAdmin
          ? NavigationBar(
              backgroundColor: const Color(0xFF101827),
              selectedIndex: _tabIndex,
              onDestinationSelected: (idx) => setState(() => _tabIndex = idx),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.power_settings_new_rounded), label: 'VPN 연결'),
                NavigationDestination(icon: Icon(Icons.admin_panel_settings_outlined), label: '관리자'),
              ],
            )
          : null,
    );
  }

  Widget _buildVpnTab() {
    final activeColor = _isConnected ? const Color(0xFF10B981) : const Color(0xFF475569);

    return RefreshIndicator(
      onRefresh: () async {
        await _loadNodes();
        await _refreshPublicIp();
      },
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        children: [
          // Public IP Status Badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFF101827),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: _isConnected
                    ? const Color(0xFF10B981).withValues(alpha: 0.45)
                    : Colors.white.withValues(alpha: 0.08),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  _isConnected ? Icons.verified_user_rounded : Icons.public_rounded,
                  color: _isConnected ? const Color(0xFF10B981) : Colors.amber,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _isConnected ? 'VPN 보호 활성화됨' : '현재 외부 공인 IP',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: _isConnected ? const Color(0xFF10B981) : Colors.white70,
                        ),
                      ),
                      Text(
                        _publicIp,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _refreshPublicIp,
                  icon: const Icon(Icons.refresh_rounded, size: 20),
                ),
              ],
            ),
          ),

          const SizedBox(height: 28),

          // Giant Circular ON/OFF Button
          Center(
            child: GestureDetector(
              onTap: _isBusy ? null : (_isConnected ? _disconnectVpn : _connectVpn),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                width: 176,
                height: 176,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF101827),
                  border: Border.all(color: activeColor, width: 4),
                  boxShadow: [
                    BoxShadow(
                      color: activeColor.withValues(alpha: _isConnected ? 0.42 : 0.12),
                      blurRadius: _isConnected ? 36 : 14,
                      spreadRadius: _isConnected ? 4 : 0,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isBusy)
                      const CircularProgressIndicator()
                    else
                      Icon(
                        Icons.power_settings_new_rounded,
                        size: 58,
                        color: _isConnected ? const Color(0xFF10B981) : Colors.white,
                      ),
                    const SizedBox(height: 8),
                    Text(
                      _isBusy
                          ? '처리 중...'
                          : (_isConnected ? '연결됨 (ON)' : '터치하여 연결'),
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: _isConnected ? const Color(0xFF10B981) : Colors.white70,
                      ),
                    ),
                    if (_isConnected) ...[
                      const SizedBox(height: 4),
                      Text(
                        _formatDuration(_uptime),
                        style: const TextStyle(fontSize: 12, color: Colors.white60),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),

          if (_activeSession != null) ...[
            const SizedBox(height: 12),
            Center(
              child: Text(
                '할당 VPN IP: ${_activeSession!.assignedIp}',
                style: const TextStyle(fontSize: 12.5, color: Colors.white60),
              ),
            ),
          ],

          if (_bannerMsg != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(_bannerMsg!, style: const TextStyle(fontSize: 12.5)),
            ),
          ],

          const SizedBox(height: 24),

          // Server Node Selector Card
          InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: _openNodeSelector,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF101827),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
              ),
              child: Row(
                children: [
                  Text(
                    _selectedNode?.countryFlag ?? '🇰🇷',
                    style: const TextStyle(fontSize: 28),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('선택된 VPN 서버', style: TextStyle(fontSize: 11.5, color: Colors.white54)),
                        Text(
                          _selectedNode?.name ?? '서버 불러오는 중...',
                          style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                  if (_selectedNode != null && _nodePings[_selectedNode!.id] != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '${_nodePings[_selectedNode!.id]} ms',
                        style: const TextStyle(
                          color: Color(0xFF10B981),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  const SizedBox(width: 6),
                  const Icon(Icons.keyboard_arrow_down_rounded),
                ],
              ),
            ),
          ),

          const SizedBox(height: 14),

          // Live Speed & Traffic Card
          Row(
            children: [
              Expanded(
                child: _statTile(
                  icon: Icons.arrow_downward_rounded,
                  label: '다운로드',
                  speed: '${_rxSpeedKbps.toStringAsFixed(1)} KB/s',
                  total: '누적 ${_formatBytes(_totalRxBytes)}',
                  accent: const Color(0xFF10B981),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _statTile(
                  icon: Icons.arrow_upward_rounded,
                  label: '업로드',
                  speed: '${_txSpeedKbps.toStringAsFixed(1)} KB/s',
                  total: '누적 ${_formatBytes(_totalTxBytes)}',
                  accent: const Color(0xFF38BDF8),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // Toggles & Export Profile Card
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF101827),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            ),
            child: Column(
              children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('앱 실행 시 자동 VPN 연결', style: TextStyle(fontSize: 14.5)),
                  subtitle: const Text('앱을 켜면 마지막 서버로 즉시 재연결합니다', style: TextStyle(fontSize: 12)),
                  value: widget.autoReconnect,
                  onChanged: widget.onToggleAutoReconnect,
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('전체 인터넷 IP 우회 모드', style: TextStyle(fontSize: 14.5)),
                  subtitle: Text(
                    widget.tunnelMode == 'full'
                        ? '모든 웹사이트에 선택한 서버 IP로 접속 중'
                        : '내부 서버(10.x) 관리 통신만 VPN 통과',
                    style: const TextStyle(fontSize: 12),
                  ),
                  value: widget.tunnelMode == 'full',
                  onChanged: (v) => widget.onChangeTunnelMode(v ? 'full' : 'split'),
                ),
                if (_activeSession != null)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () => widget.vpnEngine.exportProfileFile(_activeSession!),
                      icon: const Icon(Icons.ios_share_rounded, size: 18),
                      label: const Text('WireGuard 앱으로 열기 / .conf 공유'),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statTile({
    required IconData icon,
    required String label,
    required String speed,
    required String total,
    required Color accent,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF101827),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: accent),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(fontSize: 12, color: Colors.white60)),
            ],
          ),
          const SizedBox(height: 8),
          Text(speed, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text(total, style: const TextStyle(fontSize: 11.5, color: Colors.white54)),
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
    if (mounted) {
      setState(() => _loading = false);
    }
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
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('가족·지인 초대코드', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              FilledButton.icon(
                onPressed: _issueInvite,
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('코드 생성'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ..._invites.take(5).map((raw) {
            final inv = raw as Map<String, dynamic>;
            final code = inv['code'] as String;
            return Card(
              color: const Color(0xFF101827),
              child: ListTile(
                title: Text(code, style: const TextStyle(fontWeight: FontWeight.bold)),
                subtitle: Text('사용: ${inv['used_count']} / ${inv['max_uses']}'),
                trailing: IconButton(
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  onPressed: () => Clipboard.setData(ClipboardData(text: code)),
                ),
              ),
            );
          }),
          const SizedBox(height: 22),
          const Text('등록된 전체 기기 관리', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          ..._devices.map((raw) {
            final d = raw as Map<String, dynamic>;
            final id = (d['id'] as num).toInt();
            final enabled = d['enabled'] as bool? ?? true;
            return Card(
              color: const Color(0xFF101827),
              child: ListTile(
                leading: Icon(
                  enabled ? Icons.devices_rounded : Icons.block_rounded,
                  color: enabled ? const Color(0xFF10B981) : Colors.redAccent,
                ),
                title: Text('${d['username']} · ${d['device_name']}'),
                subtitle: Text('${d['assigned_ip']} · ${d['node_name']}'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextButton(
                      onPressed: () async {
                        await widget.api.toggleDevice(id);
                        await _refresh();
                      },
                      child: Text(enabled ? '일시정지' : '차단해제'),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent),
                      onPressed: () async {
                        await widget.api.deleteDevice(id);
                        await _refresh();
                      },
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
