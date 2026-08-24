// Escolhe a moldura pelo prop `platform` — IOSDevice / AndroidDevice já estão em window.
function RentechFrame({ platform = 'ios', children }) {
  const Device = platform === 'android' ? window.AndroidDevice : window.IOSDevice;
  if (!Device) return null;
  return React.createElement(Device, { dark: true }, children);
}
window.RentechFrame = RentechFrame;
