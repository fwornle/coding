/**
 * VKB API Client
 *
 * HTTP client for accessing VKB server API when it's running.
 * Provides automatic detection of VKB server availability.
 */

export class VkbApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:8080';
    this.timeout = options.timeout || 10000;
    this.debug = options.debug || false;
  }

  /**
   * Check if VKB server is running
   */
  async isServerAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000) // Quick check
      });

      if (response.ok) {
        const data = await response.json();
        return data.graph === true; // Server must have graph DB available
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * GET /api/entities
   */
  async getEntities(params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/entities${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get entities');
    }

    return await response.json();
  }

  /**
   * GET /api/entities (with search)
   */
  async searchEntities(query, params = {}) {
    return this.getEntities({ ...params, searchTerm: query });
  }

  /**
   * DELETE /api/entities/:name
   */
  async deleteEntity(name, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/entities/${encodeURIComponent(name)}${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete entity');
    }

    return await response.json();
  }

  /**
   * POST /api/entities
   */
  async createEntity(entityData) {
    const response = await fetch(`${this.baseUrl}/api/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entityData),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create entity');
    }

    return await response.json();
  }

  /**
   * PUT /api/entities/:name
   */
  async updateEntity(name, updates) {
    const response = await fetch(`${this.baseUrl}/api/entities/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update entity');
    }

    return await response.json();
  }

  /**
   * GET /api/relations
   */
  async getRelations(params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/relations${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get relations');
    }

    return await response.json();
  }

  /**
   * DELETE /api/relations
   */
  async deleteRelation(from, to, params = {}) {
    const query = new URLSearchParams({ from, to, ...params }).toString();
    const url = `${this.baseUrl}/api/relations?${query}`;

    const response = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete relation');
    }

    return await response.json();
  }

  /**
   * POST /api/relations
   */
  async createRelation(relationData) {
    const response = await fetch(`${this.baseUrl}/api/relations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(relationData),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create relation');
    }

    return await response.json();
  }
}
