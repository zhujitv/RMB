App({
  globalData: {
    apiBase: "https://www.nextwood.net/api/wechat-mini",
  },
  token() {
    return wx.getStorageSync("nextwoodMiniToken") || "";
  },
  setSession(session) {
    wx.setStorageSync("nextwoodMiniToken", session.token);
    wx.setStorageSync("nextwoodMiniUser", session.user || {});
  },
  clearSession() {
    wx.removeStorageSync("nextwoodMiniToken");
    wx.removeStorageSync("nextwoodMiniUser");
  },
});
