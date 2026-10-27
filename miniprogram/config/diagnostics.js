// Separate diagnostics service in the existing prod cloud environment by user choice.
// Only the mini-program develop build can offer the opt-in diagnostic control.
// Keep disabled until the service, restricted ingress, short log retention and privacy notice are verified.
module.exports = {
  enabled: false,
  env: 'prod-d5g0ea4ci0a964b1a',
  service: 'ble-diagnostics',
};
