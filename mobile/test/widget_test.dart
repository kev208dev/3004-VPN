import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vpn3004_mobile/main.dart';

void main() {
  testWidgets('3004 VPN AuthScreen renders cleanly', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const Vpn3004App());
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('삼천포 3004 VPN'), findsOneWidget);
    expect(find.text('중앙 API 서버 주소'), findsOneWidget);
  });
}
