/** Original sample scripts used for the first-run "Try a sample" action, one per UI language. */
export interface SampleScript {
  title: string;
  body: string;
}

const EN: SampleScript = {
  title: 'My first Promptly video',
  body: `Hey! This is my first video recorded with a teleprompter.

Here's the trick: I'm reading this right now, but it doesn't look like it — because the words sit right under the camera.

If I pause, the script waits for me. When I keep talking, it keeps up.

Try it yourself: tap Record, read this out loud, and see how natural it feels.`,
};

const HE: SampleScript = {
  title: 'הסרטון הראשון שלי ב-Promptly',
  body: `היי! זה הסרטון הראשון שלי שהוקלט עם טלפרומפטר.

הנה הטריק: אני קורא את זה ממש עכשיו, אבל זה לא נראה ככה — כי המילים נמצאות ממש מתחת למצלמה.

אם אני עוצר, התסריט מחכה לי. כשאני ממשיך לדבר, הוא ממשיך איתי.

נסו בעצמכם: הקישו על "הקלטה", קראו את זה בקול, ותראו כמה זה מרגיש טבעי.`,
};

const SAMPLES: Record<string, SampleScript> = { en: EN, he: HE };

/** The sample in the UI language; English when there is none for it. */
export function sampleScriptFor(language: string): SampleScript {
  return SAMPLES[language] ?? EN;
}

/** English sample (kept for callers and tests that expect it). */
export const SAMPLE_SCRIPT = EN;
