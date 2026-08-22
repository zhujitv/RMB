App({
  globalData: {
    apiBaseUrl: "https://www.nextwood.net",
    user: null,
  },
  onLaunch() {
    const override = wx.getStorageSync("supplierMiniApiBaseUrl");
    if (override) this.globalData.apiBaseUrl = String(override).replace(/\/$/, "");
  },
});
