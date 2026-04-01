export interface AvatarMetadata {
  userId: string;
  avatarId: string;
  meshUrl: string;
  textureUrl: string;
  thumbnailUrl: string;
  boundingBoxScale: number;
}

export interface QuantneonClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Retrieves 3D avatar metadata from the Quantneon hologram service.
 *
 * In environments without a live Quantneon endpoint the service falls back
 * to a deterministic stub so the rest of the system can operate normally.
 */
export class QuantneonAvatarService {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options?: Partial<QuantneonClientOptions>) {
    this.baseUrl = options?.baseUrl ?? process.env.QUANTNEON_BASE_URL ?? '';
    this.apiKey = options?.apiKey ?? process.env.QUANTNEON_API_KEY;
    this.timeoutMs = options?.timeoutMs ?? 3000;
  }

  /**
   * Fetch the 3D avatar metadata for the given user.
   *
   * When no base URL is configured a deterministic stub is returned so the
   * match pipeline never blocks on an unavailable upstream service.
   */
  async getAvatar(userId: string): Promise<AvatarMetadata> {
    if (!this.baseUrl) {
      return this.buildStubAvatar(userId);
    }

    const url = `${this.baseUrl}/v1/avatars/${encodeURIComponent(userId)}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });

      if (!response.ok) {
        return this.buildStubAvatar(userId);
      }

      const data = (await response.json()) as Partial<AvatarMetadata>;
      return this.normaliseResponse(userId, data);
    } catch {
      return this.buildStubAvatar(userId);
    } finally {
      clearTimeout(timer);
    }
  }

  private normaliseResponse(userId: string, data: Partial<AvatarMetadata>): AvatarMetadata {
    return {
      userId,
      avatarId: data.avatarId ?? `stub-${userId}`,
      meshUrl: data.meshUrl ?? `${this.baseUrl}/meshes/${userId}.glb`,
      textureUrl: data.textureUrl ?? `${this.baseUrl}/textures/${userId}.png`,
      thumbnailUrl: data.thumbnailUrl ?? `${this.baseUrl}/thumbnails/${userId}.png`,
      boundingBoxScale: data.boundingBoxScale ?? 1.0
    };
  }

  /** Deterministic stub used when Quantneon is not reachable. */
  private buildStubAvatar(userId: string): AvatarMetadata {
    return {
      userId,
      avatarId: `stub-${userId}`,
      meshUrl: `/stubs/meshes/${userId}.glb`,
      textureUrl: `/stubs/textures/${userId}.png`,
      thumbnailUrl: `/stubs/thumbnails/${userId}.png`,
      boundingBoxScale: 1.0
    };
  }
}
