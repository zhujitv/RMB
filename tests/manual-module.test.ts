import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");

test("manual explains current tax refund document upload workflow", () => {
  assert.match(manualModule, /操作手册/);
  assert.doesNotMatch(manualModule, /操作说明书/);
  assert.match(manualModule, /当前版本：v2\.4/);
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
  assert.match(manualModule, /物流信息集中维护物流状态/);
  assert.match(manualModule, /运输监控作为物流信息下的在途海运监控入口/);
  assert.match(manualModule, /title: "物流费用"/);
  assert.match(manualModule, /物流费用用于维护供应商费用账单、月结汇总、合并审核、发票分组和付款状态/);
  assert.match(manualModule, /合并审核 \/ 批量审核/);
  assert.match(manualModule, /统一在左侧菜单“物流费用”中完成/);
});

test("manual explains transport monitor and Da Zhang Gui tracking rules", () => {
  assert.match(manualModule, /title: "运输监控"/);
  assert.match(manualModule, /默认打开全屏监控视图/);
  assert.match(manualModule, /在途总票数、即将到港、ETA 已过期、同步失败和今日已同步/);
  assert.match(manualModule, /只同步本地已有的大掌櫃 Tracking ID，不会创建新的跟踪/);
  assert.match(manualModule, /管理员可查看全部大掌櫃海运跟踪；业务员仅查看本人负责订单；物流供应商仅查看被分配订单/);
  assert.match(manualModule, /产品供应商不可见/);
  assert.match(manualModule, /一张 Master B\/L 在系统生命周期内只创建一次大掌櫃 Tracking/);
  assert.match(manualModule, /后台页面优先显示中文船公司、港口、状态和跟踪方式/);
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

test("manual homepage removes the duplicated rule summary block", () => {
  assert.doesNotMatch(manualModule, />重要规则</);
  assert.doesNotMatch(manualModule, /const IMPORTANT_RULES/);
  assert.doesNotMatch(manualModule, /manualRuleCard/);
  assert.match(manualModule, /总体完整度不足 100% 不允许提交退税/);
  assert.match(manualModule, /归档不是删除/);
  assert.match(manualModule, /所有业务附件上传入口统一只支持 PDF，单个文件最大 5MB/);
});

test("manual explains company profile and system branding settings", () => {
  assert.match(manualModule, /公司资料、系统品牌/);
  assert.match(manualModule, /品牌名称、系统名称、中英文公司名称和联系方式/);
  assert.match(manualModule, /登录页品牌、工作台侧边栏、首页欢迎语、Logo 和页脚版权/);
  assert.match(manualModule, /产品供应商资料回传权限/);
  assert.match(manualModule, /物流费用开票通知模板、抄送邮箱和公司品牌配置/);
  assert.match(manualModule, /大掌櫃接口开关、API Key、Webhook Secret、手动同步和每日自动同步设置/);
  assert.match(manualModule, /大掌櫃关闭后，物流信息和运输监控不显示相关创建、同步和查看入口/);
});
