import type { Readable } from 'node:stream';

/**
 * The storage seam.
 *
 * Both drivers implement all five methods, including the read side — an abstraction
 * that only covered writes would leak the moment the frontend needed to fetch a file,
 * because the two drivers differ fundamentally there: one streams bytes from disk, the
 * other hands out a time-limited URL.
 */
export interface FileStorage {
  readonly driver: 'local' | 's3';

  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;

  /**
   * A URL the browser may fetch directly, or `null` when the driver cannot issue one.
   * `null` tells the download route to stream the bytes itself, which is how the local
   * driver works and why the frontend never needs to know which driver is active.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}
