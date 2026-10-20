/** Lets the user pick a backup file and returns its text, or null if cancelled. */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export async function pickBackupText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets[0]) return null;
  return new File(res.assets[0].uri).text();
}
