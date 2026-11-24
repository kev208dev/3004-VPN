import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vpn3004_mobile/main.dart';

void main() {
  testWidgets('3004 VPN refined AuthScreen renders cleanly', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const Vpn3004App());
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('3004 VPN'), findsOneWidget);
    expect(find.text('서버 설정'), findsOneWidget);
  });
}
