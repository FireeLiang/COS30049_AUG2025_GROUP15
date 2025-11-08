// src/api.js
const BASE_URL = 'http://127.0.0.1:8000';  // talk directly to FastAPI

async function asJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    // Helpful error when HTML comes back instead of JSON
    throw new Error(`Expected JSON but got: ${text.slice(0, 120)}...`);
  }
}

export async function getStates() {
  const r = await fetch(`${BASE_URL}/states`);
  if (!r.ok) throw new Error('Failed to load states');
  return asJson(r);
}
export async function getMonths() {
  const r = await fetch(`${BASE_URL}/months`);
  if (!r.ok) throw new Error('Failed to load months');
  return asJson(r);
}
export async function getYears() {
  const r = await fetch(`${BASE_URL}/years`);
  if (!r.ok) throw new Error('Failed to load years');
  return asJson(r);
}
export async function getTrends({ month, year, states }) {
  const qs = new URLSearchParams({
    month: String(month),
    year: String(year),
    states: states.join(','),
  });
  const r = await fetch(`${BASE_URL}/trends?${qs.toString()}`);
  if (!r.ok) throw new Error('Failed to load trends');
  return asJson(r);
}
