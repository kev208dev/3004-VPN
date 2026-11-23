import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:wireguard_flutter/wireguard_flutter.dart';

import '../models/vpn_models.dart';

class MobileVpnEngine {
  static const String _ifaceName = 'wg3004';
  static const String _iosProviderBundle = 'dev.kev208.vpn3004.vpn3004_mobile.WGExtension';

  bool _initialized = false;

  Stream<VpnStage> get stageStream {
    if (kIsWeb) return const Stream.empty();
    try {
      return WireGuardFlutter.instance.vpnStageSnapshot;
    } catch (_) {
      return const Stream.empty();
    }
  }

  Future<void> ensureInitialized() async {
    if (_initialized || kIsWeb) return;
    await WireGuardFlutter.instance.initialize(interfaceName: _ifaceName);
    _initialized = true;
  }

  Future<void> startTunnel(ConnectSession session) async {
    await ensureInitialized();
    await WireGuardFlutter.instance.startVpn(
      serverAddress: session.endpoint,
      wgQuickConfig: session.config,
      providerBundleIdentifier: _iosProviderBundle,
    );
  }

  Future<void> stopTunnel() async {
    await ensureInitialized();
    await WireGuardFlutter.instance.stopVpn();
  }

  Future<bool> checkConnected() async {
    try {
      await ensureInitialized();
      return await WireGuardFlutter.instance.isConnected();
    } catch (_) {
      return false;
    }
  }

  /// Shares a ready-to-import `.conf` file (ideal fallback on iOS without a paid NetworkExtension profile).
  Future<void> exportProfileFile(ConnectSession session) async {
    final dir = await getTemporaryDirectory();
    final safeRegion = session.region.toLowerCase();
    final file = File('${dir.path}/3004-VPN-$safeRegion.conf');
    await file.writeAsString(session.config, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: 'application/octet-stream')],
        subject: '삼천포(3004) VPN 프로필',
        text: 'WireGuard 앱으로 열기를 선택하면 즉시 연결됩니다.',
      ),
    );
  }
}
