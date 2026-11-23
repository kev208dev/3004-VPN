class UserProfile {
  final int id;
  final String username;
  final String role;
  final bool enabled;

  const UserProfile({
    required this.id,
    required this.username,
    required this.role,
    required this.enabled,
  });

  bool get isAdmin => role == 'admin';

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: (json['id'] as num).toInt(),
      username: json['username'] as String,
      role: json['role'] as String,
      enabled: json['enabled'] as bool? ?? true,
    );
  }
}

class VpnNode {
  final String id;
  final String name;
  final String region;
  final String countryFlag;
  final String host;
  final int port;
  final String endpoint;
  final String subnet;
  final bool isLocal;

  const VpnNode({
    required this.id,
    required this.name,
    required this.region,
    required this.countryFlag,
    required this.host,
    required this.port,
    required this.endpoint,
    required this.subnet,
    required this.isLocal,
  });

  factory VpnNode.fromJson(Map<String, dynamic> json) {
    return VpnNode(
      id: json['id'] as String,
      name: json['name'] as String,
      region: json['region'] as String,
      countryFlag: json['country_flag'] as String? ?? '🌐',
      host: json['host'] as String,
      port: (json['port'] as num).toInt(),
      endpoint: json['endpoint'] as String,
      subnet: json['subnet'] as String,
      isLocal: json['is_local'] as bool? ?? false,
    );
  }
}

class ConnectSession {
  final int deviceId;
  final String nodeId;
  final String nodeName;
  final String region;
  final String assignedIp;
  final String dns;
  final String endpoint;
  final String serverPublicKey;
  final String allowedIps;
  final String config;

  const ConnectSession({
    required this.deviceId,
    required this.nodeId,
    required this.nodeName,
    required this.region,
    required this.assignedIp,
    required this.dns,
    required this.endpoint,
    required this.serverPublicKey,
    required this.allowedIps,
    required this.config,
  });

  factory ConnectSession.fromJson(Map<String, dynamic> json) {
    return ConnectSession(
      deviceId: (json['device_id'] as num).toInt(),
      nodeId: json['node_id'] as String,
      nodeName: json['node_name'] as String,
      region: json['region'] as String,
      assignedIp: json['assigned_ip'] as String,
      dns: json['dns'] as String,
      endpoint: json['endpoint'] as String,
      serverPublicKey: json['server_public_key'] as String,
      allowedIps: json['allowed_ips'] as String,
      config: json['config'] as String,
    );
  }
}
