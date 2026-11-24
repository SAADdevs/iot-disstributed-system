const fs = require('fs/promises');
const path = require('path');

const FILE = process.env.THRESHOLDS_FILE || path.join(__dirname, '../../data/thresholds.json');

const DEFAULTS = {
  temperature: { min: 5, max: 35 },
  humidity: { min: 20, max: 90 },
  soil_humidity: { min: 20, max: 100 },
};

async function readThresholds() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // Awl mra: lfichier ma kaynch => valeurs par défaut
    if (err.code === 'ENOENT') return structuredClone(DEFAULTS);
    throw err;
  }
}

async function updateThresholds(update) {
  const merged = await readThresholds();

  for (const [metric, limitsUpdate] of Object.entries(update)) {
    merged[metric] = { ...merged[metric], ...limitsUpdate };
  }

  // Wach min <= max (7ta ila wa7d jay mn update w lokhra mn l'ancien)
  for (const [metric, { min, max }] of Object.entries(merged)) {
    if (min !== undefined && max !== undefined && min > max) {
      const error = new Error(`${metric}: min (${min}) must be <= max (${max})`);
      error.status = 400;
      throw error;
    }
  }

  // Ktaba "atomique": nktbo f fichier mo2aqqat w mn be3d n-7wlo smiyto
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(merged, null, 2));
  await fs.rename(tmp, FILE);

  return merged;
}

module.exports = { readThresholds, updateThresholds };