import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vpn3004_mobile/main.dart';

void main() {
  testWidgets('3004 VPN 3-step onboarding renders cleanly', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const Vpn3004App());
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('3004 VPN 시작하기'), findsOneWidget);
    expect(find.text('서버 연결'), findsOneWidget);
    expect(find.text('계정 인증'), findsOneWidget);
    expect(find.text('시작 설정'), findsOneWidget);
  });
}
