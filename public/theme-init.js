// Apply before styles load so a saved dark theme never flashes light.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('dwm-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (error) {
    console.warn('Theme preference could not be read; using the system theme.', error);
  }
  const dark =
    preference === 'dark' ||
    (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#111c17' : '#234d3c';
})();
