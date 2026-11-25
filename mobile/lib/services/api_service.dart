import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../models/vpn_models.dart';

class ApiException implements Exception {
  final String message;
  final int statusCode;
  const ApiException(this.message, {this.statusCode = 0});

  @override
  String toString() => message;
}

class ApiService {
  String baseUrl;
  String? token;

  ApiService({required this.baseUrl, this.token});

  static String normalizeBaseUrl(String raw) {
    var s = raw.trim().replaceAll(RegExp(r'/+$'), '');
    if (s.isEmpty) return 'http://10.77.0.1:8000';
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) {
      final isPrivate = RegExp(r'^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[0-1])\.)').hasMatch(s);
      s = '${isPrivate ? 'http' : 'https'}://$s';
    }
    return s;
  }

  String get _cleanBase => normalizeBaseUrl(baseUrl);

  Map<String, String> _headers({bool auth = false}) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (auth && token != null && token!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  String _extractError(http.Response res) {
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map && decoded['detail'] != null) {
        return decoded['detail'].toString();
      }
    } catch (_) {}
    return '서버 요청 실패 (HTTP ${res.statusCode})';
  }

  Future<Map<String, dynamic>> checkHealth() async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final res = await http
            .get(Uri.parse('$_cleanBase/api/v1/health'), headers: _headers())
            .timeout(const Duration(milliseconds: 7500));
        if (res.statusCode != 200) {
          throw ApiException(_extractError(res), statusCode: res.statusCode);
        }
        return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      } on ApiException {
        rethrow;
      } catch (_) {
        if (attempt == 0) {
          await Future<void>.delayed(const Duration(milliseconds: 700));
          continue;
        }
        throw ApiException('서버 응답 시간 초과 ($_cleanBase) — 네트워크나 주소를 확인해 주세요.');
      }
    }
    throw ApiException('서버에 연결할 수 없습니다 ($_cleanBase).');
  }

  Future<(String, UserProfile)> bootstrap({
    required String username,
    required String password,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/auth/bootstrap'),
          headers: _headers(),
          body: jsonEncode({'username': username, 'password': password}),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final tk = data['access_token'] as String;
    token = tk;
    return (tk, UserProfile.fromJson(data['user'] as Map<String, dynamic>));
  }

  Future<(String, UserProfile)> register({
    required String username,
    required String password,
    required String inviteCode,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/auth/register'),
          headers: _headers(),
          body: jsonEncode({
            'username': username,
            'password': password,
            'invite_code': inviteCode,
          }),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final tk = data['access_token'] as String;
    token = tk;
    return (tk, UserProfile.fromJson(data['user'] as Map<String, dynamic>));
  }

  Future<(String, UserProfile)> login({
    required String username,
    required String password,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/auth/login'),
          headers: _headers(),
          body: jsonEncode({'username': username, 'password': password}),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final tk = data['access_token'] as String;
    token = tk;
    return (tk, UserProfile.fromJson(data['user'] as Map<String, dynamic>));
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/auth/change-password'),
          headers: _headers(auth: true),
          body: jsonEncode({
            'current_password': currentPassword,
            'new_password': newPassword,
          }),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
  }

  Future<UserProfile> getMe() async {
    final res = await http
        .get(Uri.parse('$_cleanBase/api/v1/me'), headers: _headers(auth: true))
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res), statusCode: res.statusCode);
    }
    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return UserProfile.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<List<VpnNode>> listNodes() async {
    final res = await http
        .get(Uri.parse('$_cleanBase/api/v1/nodes'), headers: _headers(auth: true))
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
    return list.map((e) => VpnNode.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<ConnectSession> requestConnect({
    required String nodeId,
    required String deviceUid,
    required String deviceName,
    required String platform,
    required String mode,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/connect'),
          headers: _headers(auth: true),
          body: jsonEncode({
            'node_id': nodeId,
            'device_uid': deviceUid,
            'device_name': deviceName,
            'platform': platform,
            'mode': mode,
          }),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    return ConnectSession.fromJson(
      jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>,
    );
  }

  Future<String> fetchPublicIp() async {
    try {
      final res = await http
          .get(Uri.parse('https://api.ipify.org?format=json'))
          .timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return data['ip'] as String;
      }
    } catch (_) {}
    final fallback = await http
        .get(Uri.parse('$_cleanBase/api/v1/my-ip'))
        .timeout(const Duration(seconds: 4));
    if (fallback.statusCode == 200) {
      final data = jsonDecode(fallback.body) as Map<String, dynamic>;
      return data['ip'] as String;
    }
    return '확인 불가';
  }

  Future<int?> measurePingMs(VpnNode node) async {
    final sw = Stopwatch()..start();
    try {
      if (node.isLocal) {
        final res = await http
            .get(Uri.parse('$_cleanBase/api/v1/ping'))
            .timeout(const Duration(seconds: 3));
        sw.stop();
        if (res.statusCode == 200) {
          return sw.elapsedMilliseconds;
        }
      } else {
        final sock = await Socket.connect(
          node.host,
          443,
          timeout: const Duration(seconds: 2),
        );
        sw.stop();
        sock.destroy();
        return sw.elapsedMilliseconds;
      }
    } catch (_) {
      sw.stop();
    }
    return null;
  }

  // ---------------- Admin Methods ---------------- //

  Future<Map<String, dynamic>> getAdminOverview() async {
    final res = await http
        .get(
          Uri.parse('$_cleanBase/api/v1/admin/overview'),
          headers: _headers(auth: true),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> createInvite({
    required String memo,
    int maxUses = 1,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/admin/invites'),
          headers: _headers(auth: true),
          body: jsonEncode({'memo': memo, 'max_uses': maxUses}),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  Future<void> toggleDevice(int deviceId) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/admin/devices/$deviceId/toggle'),
          headers: _headers(auth: true),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
  }

  Future<void> deleteDevice(int deviceId) async {
    final res = await http
        .delete(
          Uri.parse('$_cleanBase/api/v1/admin/devices/$deviceId'),
          headers: _headers(auth: true),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
  }

  Future<void> createRemoteNode(Map<String, dynamic> payload) async {
    final res = await http
        .post(
          Uri.parse('$_cleanBase/api/v1/admin/nodes'),
          headers: _headers(auth: true),
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      throw ApiException(_extractError(res));
    }
  }
}
