# בדיקה באייפון דרך TestFlight — מה צריך ממך

באייפון אי אפשר להתקין קובץ כמו באנדרואיד: צריך בנייה חתומה של Apple. הדרך הפשוטה היא TestFlight.

## מה עולה כסף (דורש את אישורך)
- **Apple Developer Program** — מנוי שנתי של Apple (בערך 99$ לשנה). חובה גם ל-TestFlight וגם לחנות.
- **EAS Build** — בתוכנית החינמית של Expo יש מספר מוגבל של בניות iOS בחודש; לבדיקות שלנו זה בדרך כלל מספיק.

## מה צריך לעשות (פעם אחת)
1. להירשם ל-Apple Developer Program עם Apple ID שלך.
2. לפתוח חשבון ב-expo.dev.
3. ב-expo.dev: Account settings → Access tokens → ליצור טוקן.
4. להכניס את הטוקן כ-`EXPO_TOKEN` בהגדרות הסביבה (לא בצ'אט!).
5. להחליט על **מזהה האפליקציה** (bundle id), למשל `com.<company>.<app>` — כרגע יש מזהה זמני
   `app.promptly.placeholder`, וכדאי לבחור את הסופי לפני הבנייה הראשונה, כי אחר כך קשה לשנות.

## מה אני עושה אחרי זה
1. `eas init` — מקשר את הפרויקט לחשבון שלך.
2. `eas build -p ios --profile testflight` — בנייה בענן של Expo (בערך 20–40 דקות).
3. `eas submit -p ios --profile testflight` — העלאה ל-App Store Connect. בפעם הראשונה Apple תבקש
   ממך להתחבר ולאשר (כולל אימות דו-שלבי).
4. ב-App Store Connect → TestFlight מוסיפים אותך כבודק, ומתקינים מאפליקציית TestFlight באייפון.

פרופיל הבנייה `testflight` כבר מוגדר ב-`eas.json` (עם צריבת כתוביות פעילה, כמו בגרסת הבדיקה של אנדרואיד).
