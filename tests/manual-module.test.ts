import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");

test("manual explains current tax refund document upload workflow", () => {
  assert.match(manualModule, /当前版本：v2\.2/);
  assert.match(manualModule, /出口资料上传和报关资料上传区域，按资料卡片上传 PDF/);
  assert.match(manualModule, /预览、下载、删除或替换当前 PDF/);
  assert.match(manualModule, /重新识别报关单/);
  assert.match(manualModule, /删除报关单会同步清空报关单号和申报日期/);
});

test("manual explains customs declaration recognition from logistics upload", () => {
  assert.match(manualModule, /报关单 PDF 上传成功后，系统自动识别报关单号和申报日期/);
  assert.match(manualModule, /报关单只保留一个当前有效 PDF/);
  assert.match(manualModule, /识别失败，不影响文件上传/);
});

test("manual explains account and upload security rules", () => {
  assert.match(manualModule, /账号与安全/);
  assert.match(manualModule, /使用系统正式网址进入登录页/);
  assert.match(manualModule, /请求来源不合法/);
  assert.match(manualModule, /缺少请求来源校验信息/);
  assert.match(manualModule, /含脚本、自动打开动作、嵌入文件等主动内容的 PDF 会被系统拒绝/);
  assert.match(manualModule, /文件预览、下载、删除均受权限控制/);
});

test("manual homepage keeps rules without the redundant important rules heading", () => {
  assert.doesNotMatch(manualModule, />重要规则</);
  assert.match(manualModule, /已提交退税前，总体完整度必须为 100%/);
  assert.match(manualModule, /PDF 附件只能上传普通 PDF/);
});
