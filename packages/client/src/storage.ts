const PREFIX = 'yilan.';

/** localStorage sarmalayıcı: gizli mod vb. durumlarda sessizce varsayılana düşer. */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // depolama kullanılamıyor; ayar yalnızca bu oturumda geçerli
    }
  },
};
