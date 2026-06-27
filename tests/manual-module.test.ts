import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");

test("manual explains current tax refund document upload workflow", () => {
  assert.match(manualModule, /操作手册/);
  assert.doesNotMatch(manualModule, /操作说明书/);
  assert.match(manualModule, /当前版本：v2\.3/);
  assert.match(manualModule, /出口资料上传和报关资料上传区域，按资料卡片上传 PDF/);
  assert.match(manualModule, /通知产品供应商回传工厂采购合同和工厂增值税发票 PDF/);
  assert.match(manualModule, /预览、下载、删除或替换当前 PDF/);
  assert.match(manualModule, /重新识别报关单/);
  assert.match(manualModule, /删除报关单会同步清空报关单号和申报日期/);
});

test("manual explains customs declaration recognition from logistics upload", () => {
  assert.match(manualModule, /报关单 PDF 上传成功后，系统自动识别报关单号和申报日期/);
  assert.match(manualModule, /报关单只保留一个当前有效 PDF/);
  assert.match(manualModule, /识别失败，不影响文件上传/);
});

test("manual explains unified logistics cost entry and review flow", () => {
  assert.match(manualModule, /物流信息是物流模块唯一入口/);
  assert.match(manualModule, /物流费用录入与审核/);
  assert.match(manualModule, /合并审核 \/ 批量审核/);
  assert.match(manualModule, /左侧菜单不再单独显示“物流费用审核”/);
});

test("manual explains cost list grouping and logistics invoice handling", () => {
  assert.match(manualModule, /发票组 \/ Shipment 组展示/);
  assert.match(manualModule, /CNY 合计、USD 合计/);
  assert.match(manualModule, /发票号、文件名、包含费用类型和明细资料/);
  assert.match(manualModule, /成本管理只同步展示结果/);
});

test("manual explains bulk warehouse logistics mode", () => {
  assert.match(manualModule, /散货进舱/);
  assert.match(manualModule, /对应运输\/进舱信息/);
});

test("manual explains account and upload security rules", () => {
  assert.match(manualModule, /账号与安全/);
  assert.match(manualModule, /使用系统正式网址进入登录页/);
  assert.match(manualModule, /请求来源不合法/);
  assert.match(manualModule, /缺少请求来源校验信息/);
  assert.match(manualModule, /所有业务附件上传入口统一只支持 PDF，单个文件最大 5MB/);
  assert.match(manualModule, /含脚本、自动打开动作、嵌入文件等主动内容的 PDF 会被系统拒绝/);
  assert.match(manualModule, /文件预览、下载、删除均受权限控制/);
});

test("manual homepage keeps rules without the redundant important rules heading", () => {
  assert.doesNotMatch(manualModule, />重要规则</);
  assert.match(manualModule, /已提交退税前，总体完整度必须为 100%/);
  assert.match(manualModule, /PDF 附件只能上传普通 PDF/);
});

test("manual explains company profile and system branding settings", () => {
  assert.match(manualModule, /公司资料、系统品牌/);
  assert.match(manualModule, /品牌名称、系统名称、中英文公司名称和联系方式/);
  assert.match(manualModule, /登录页品牌、工作台侧边栏、首页欢迎语、Logo 和页脚版权/);
  assert.match(manualModule, /产品供应商资料回传权限/);
  assert.match(manualModule, /物流费用开票通知模板、抄送邮箱和公司品牌配置/);
});
