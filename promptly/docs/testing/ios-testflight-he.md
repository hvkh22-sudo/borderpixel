# בדיקה באייפון דרך TestFlight — מה צריך ממך (מעודכן 21.11)

הבנייה וההעלאה רצות אוטומטית ב-GitHub (תהליך `promptly-testflight`). ממך צריך פעם אחת שלושה דברים
באתרים (בערך 15 דקות), ואחר כך רק מספר אחד מ-App Store Connect.

## שלב 1 — טוקן של Expo (חינם)
expo.dev → מתחברים/נרשמים → Account settings → Access tokens → Create token → מעתיקים.

## שלב 2 — מפתח API של App Store Connect
1. appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → Team Keys → ‎+‎.
2. שם: `EAS`, הרשאה: **App Manager** → Generate.
3. שומרים: **Key ID**, **Issuer ID** (למעלה בעמוד), ומורידים את קובץ ה-‎.p8 (אפשר להוריד רק פעם אחת).
4. developer.apple.com → Account → Membership details → **Team ID**. שם גם כתוב אם החשבון של
   אדם פרטי (Individual) או של חברה (Organization).

## שלב 3 — סודות ב-GitHub (לא בצ'אט!)
github.com/hvkh22-sudo/borderpixel → Settings → Secrets and variables → Actions → New repository secret.
מוסיפים חמישה:

| שם | ערך |
|----|-----|
| `EXPO_TOKEN` | הטוקן משלב 1 |
| `ASC_KEY_ID` | ה-Key ID |
| `ASC_ISSUER_ID` | ה-Issuer ID |
| `ASC_KEY_P8` | כל התוכן של קובץ ה-‎.p8 (פותחים בעורך טקסט, כולל שורות BEGIN/END) |
| `APPLE_TEAM_ID` | ה-Team ID |

## שלב 4 — החלטה: מזהה האפליקציה (bundle id)
למשל `com.<השם-שלך>.teleprompter`. אחרי שהאפליקציה נוצרת ב-App Store Connect אי אפשר לשנות אותו.
כותבים לי אותו (זה לא סוד).

## מה קורה אחרי זה
1. **אני** מפעיל את הבנייה (בלי העלאה). Expo בונה בענן 30–40 דקות, ובדרך רושם את המזהה אצל Apple
   ויוצר את אישורי החתימה עם המפתח שלך.
2. **אתה** (פעם אחת, 2 דקות): App Store Connect → Apps → ‎+‎ → New App → iOS, שם (למשל "Promptly Beta"),
   שפה, בוחרים את המזהה מהרשימה, SKU כלשהו (למשל `promptly-beta`) → Create. בעמוד האפליקציה,
   App Information → **Apple ID** (מספר) — שולחים לי אותו.
3. **אני** מפעיל שוב עם העלאה ל-TestFlight. Apple מעבדת עוד 10–30 דקות.
4. **אתה**: App Store Connect → TestFlight → Internal Testing → מוסיפים את עצמך, מתקינים את אפליקציית
   TestFlight מה-App Store ומקבלים את האפליקציה.

## עלויות
- Apple Developer Program — כבר יש לך.
- EAS Build — בתוכנית החינמית של Expo יש מכסת בניות חודשית; מספיק לבדיקות.
- GitHub Actions — דקות ריצה של מכונת Linux בלבד (הבנייה עצמה אצל Expo).
