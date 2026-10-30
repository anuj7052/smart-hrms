/**
 * Reverse geocoding using OpenStreetMap Nominatim (free, no API key needed).
 * Returns a short human-readable address like "Sector 62, Noida, Uttar Pradesh".
 * Usage policy: max 1 req/sec — we only call on actual punches so this is fine.
 */

// Simple in-memory cache so the same coordinates aren't looked up twice
const cache = new Map<string, string>();

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      {
        headers: {
          // Nominatim usage policy requires a meaningful User-Agent
          'User-Agent': 'SphereHRMS/1.0 (contact@foetron.com)',
          'Accept-Language': 'en',
        },
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const a = data.address || {};

    // Build a short address: shop/building → road/suburb → city → state
    const line1 = a.shop || a.building || a.amenity || a.office || a.road || a.pedestrian || a.footway || '';
    const locality = a.suburb || a.neighbourhood || a.quarter || a.village || a.town || '';
    const city = a.city || a.county || '';
    const state = a.state || '';

    const parts = [line1, locality, city, state].filter(Boolean);
    const short = parts.length >= 2 ? parts.slice(0, 3).join(', ') : data.display_name?.split(',').slice(0, 4).join(',').trim() || null;

    if (short) cache.set(key, short);
    return short;
  } catch {
    return null;
  }
}
