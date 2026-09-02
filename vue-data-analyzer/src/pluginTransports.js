export function getPluginTransport(plugin) {
  const rawKeywords = plugin?.keywords;
  const keywords = (Array.isArray(rawKeywords) ? rawKeywords : String(rawKeywords || '').split(/[\s,]+/))
    .map(keyword => String(keyword).toLowerCase());
  const supportsHap = keywords.includes('supports-hap');
  const supportsMatter = keywords.includes('supports-matter');

  if (supportsHap && supportsMatter) return 'HAP + Matter';
  if (supportsMatter) return 'Matter';
  return 'HAP';
}
