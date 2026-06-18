import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");

test("manual explains current tax refund document upload workflow", () => {
  assert.match(manualModule, /当前版本：v2\.1/);
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
