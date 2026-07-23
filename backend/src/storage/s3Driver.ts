import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import type { FileStorage } from './types.ts';

/**
 * The production driver. Implemented and type-checked against the real SDK rather than
 * stubbed, so the abstraction is demonstrably a seam and not a comment — but no AWS
 * resources are provisioned for this demo, per the deployment posture in the spec.
 */
export class S3FileStorage implements FileStorage {
  readonly driver = 's3' as const;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(bucket: string, region: string) {
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`S3 object has no body: ${key}`);
    }
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hands the browser a short-lived URL so file bytes never travel through the API.
   * The download route turns this into a 302, which is why swapping drivers changes
   * nothing for the frontend.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
