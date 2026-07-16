import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");

test("manual explains current tax refund document upload workflow", () => {
  assert.match(manualModule, /操作手册/);
  assert.doesNotMatch(manualModule, /操作说明书/);
  assert.match(manualModule, /当前版本：v3\.0/);
  assert.match(manualModule, /出口资料上传和报关资料上传区域，按资料卡片上传 PDF/);
  assert.match(manualModule, /退税详情仅显示状态提示和前往资料回传入口/);
  assert.match(manualModule, /预览、下载、删除或替换当前 PDF/);
  assert.match(manualModule, /报关单号和申报日期由人工维护/);
  assert.match(manualModule, /删除报关单会同步清空报关单号和申报日期/);
});

test("manual explains tax refund logistics transport summary", () => {
  assert.match(manualModule, /基础信息卡片核对客户全称、订单号、提单号、币种、申报日期和物流信息状态/);
  assert.match(manualModule, /运输信息摘要卡片核对集装箱号、柜型、车牌号、挂车车牌、起运日期、起运地、到达地和运输货物名称/);
  assert.match(manualModule, /按提单号读取同一票物流信息/);
  assert.match(manualModule, /一票多柜或同提单多订单时，运输信息摘要会按柜号分卡片展示/);
  assert.match(manualModule, /物流信息已归档时，退税详情仍会显示已保存的结构化运输明细/);
  assert.match(manualModule, /点击重新计算完整度，系统重新拉取物流明细、物流费用发票和产品供应商回传资料状态/);
  assert.match(manualModule, /整柜 FOB 需要报关费、拖车费、港杂费发票/);
  assert.match(manualModule, /拼箱、散货或非整柜出口不强制判断港杂费/);
});

test("manual explains customs declaration manual maintenance from logistics upload", () => {
  assert.match(manualModule, /报关单 PDF 上传成功后，可在退税资料详情中手工维护报关单号和申报日期/);
  assert.match(manualModule, /报关单只保留一个当前有效 PDF/);
  assert.doesNotMatch(manualModule, /识别失败，不影响文件上传/);
});

test("manual explains unified logistics cost entry and review flow", () => {
  assert.match(manualModule, /物流信息维护首程运输、集装箱、报关资料和物流归档状态/);
  assert.match(manualModule, /页面只保留物流列表和运输监控/);
  assert.match(manualModule, /title: "物流费用"/);
  assert.match(manualModule, /物流费用以物流账单为单位管理费用明细、发票上传校验、审核、月结汇总和付款状态/);
  assert.match(manualModule, /管理员核对订单、提单、客户、费用类型、金额和币种后可直接审核通过，不要求预先上传发票/);
  assert.match(manualModule, /审核通过后账单进入待开票，系统自动通知物流供应商上传对应发票/);
  assert.match(manualModule, /供应商上传 PDF 后发票状态变为已上传/);
  assert.match(manualModule, /管理员或财务核对并确认全部发票后，账单才进入待付款/);
  assert.match(manualModule, /只有审核通过、发票全部确认且处于待付款的账单才可标记已付款/);
  assert.match(manualModule, /标记已付款时必须录入付款时间/);
  assert.match(manualModule, /海运费、ENS费、保险费及所有 USD 费用归入海运费发票/);
});

test("manual explains transport monitor and Da Zhang Gui tracking rules", () => {
  assert.match(manualModule, /title: "运输监控"/);
  assert.match(manualModule, /默认打开全屏监控视图/);
  assert.match(manualModule, /在途总票数、即将到港、ETA 已过期、同步失败、今日已同步和关联柜号数/);
  assert.match(manualModule, /只同步本地已有的大掌柜 Tracking ID，不会创建新的跟踪/);
  assert.match(manualModule, /管理员可查看全部海运跟踪；业务员可查看自己负责订单；物流供应商可全局查看系统内物流信息/);
  assert.match(manualModule, /产品供应商不可见/);
  assert.match(manualModule, /一张 Master B\/L 在系统生命周期内只创建一次大掌柜 Tracking/);
  assert.match(manualModule, /后台页面优先显示中文船公司、港口、状态和跟踪方式/);
});

test("manual explains cost list grouping and logistics invoice handling", () => {
  assert.match(manualModule, /列表按订单 \/ 发票组展示/);
  assert.match(manualModule, /CNY 合计、USD 合计/);
  assert.match(manualModule, /产品供应商采购合同、增值税发票和付款凭证/);
  assert.match(manualModule, /成本管理只同步展示结果/);
  assert.match(manualModule, /发票异常清单中查看已付款未收票、已确认未收票和超期未收票/);
});

test("manual explains bulk warehouse logistics mode", () => {
  assert.match(manualModule, /散货进舱/);
  assert.match(manualModule, /散货进舱信息/);
});

test("manual explains account and upload security rules", () => {
  assert.match(manualModule, /账号与安全/);
  assert.match(manualModule, /使用系统正式网址进入登录页/);
  assert.match(manualModule, /请求来源不合法/);
  assert.match(manualModule, /缺少请求来源校验信息/);
  assert.match(manualModule, /所有业务附件上传入口统一只支持 PDF，单个文件最大 10MB/);
  assert.doesNotMatch(manualModule, /主动内容的 PDF 会被系统拒绝/);
  assert.doesNotMatch(manualModule, /带主动内容的 PDF 附件/);
  assert.match(manualModule, /文件预览、下载、删除均受权限控制/);
});

test("manual homepage removes the duplicated rule summary block", () => {
  assert.doesNotMatch(manualModule, />重要规则</);
  assert.doesNotMatch(manualModule, /const IMPORTANT_RULES/);
  assert.doesNotMatch(manualModule, /manualRuleCard/);
  assert.match(manualModule, /总体完整度不足 100% 不允许提交退税/);
  assert.match(manualModule, /归档不是删除/);
  assert.match(manualModule, /所有业务附件上传入口统一只支持 PDF，单个文件最大 10MB/);
});

test("manual explains company profile and system branding settings", () => {
  assert.match(manualModule, /公司品牌/);
  assert.match(manualModule, /品牌名称、系统名称、中英文公司名称、联系方式/);
  assert.match(manualModule, /登录页品牌、工作台侧边栏、首页欢迎语、Logo 和页脚版权/);
  assert.match(manualModule, /产品供应商资料回传权限/);
  assert.match(manualModule, /物流费用开票通知模板、收件邮箱读取顺序、额外抄送邮箱/);
  assert.match(manualModule, /大掌柜接口开关、API Key、Webhook Secret、海运跟踪、手动同步、每日自动同步/);
  assert.match(manualModule, /大掌柜关闭后，物流信息和运输监控不显示相关创建、同步和查看入口/);
});

test("manual covers the complete workspace application map", () => {
  assert.match(manualModule, /工作台与待办/);
  assert.match(manualModule, /轻量工作台，不预加载所有业务模块数据/);
  assert.match(manualModule, /业务主体用于标记数据归属公司/);
  assert.match(manualModule, /正式合同、单据、导出和 PDF 使用业务主体公司全称/);
  assert.match(manualModule, /已有订单如需变更业务主体，必须通过详情里的业务主体转移操作处理/);
  assert.match(manualModule, /资料回传是产品供应商上传工厂采购合同和工厂增值税发票 PDF 的入口/);
  assert.match(manualModule, /上传完成后系统立即更新当前任务状态/);
  assert.match(manualModule, /合同和发票均已上传成功时，任务自动变为已完成/);
  assert.match(manualModule, /上传文件最终归集到退税资料，资料回传不是独立资料库/);
  assert.match(manualModule, /经营总览展示核心经营指标、趋势、风险和绩效/);
  assert.match(manualModule, /利润分析按订单核算应收、已到账、成本、退税、毛利和业务员提成/);
  assert.match(manualModule, /角色权限速览/);
});

test("manual explains report center and account security workflow", () => {
  assert.match(manualModule, /应收订单明细、收款明细、成本明细、利润分析、业务员提成、逾期催款或退税资料/);
  assert.match(manualModule, /客户名称支持客户全称和客户简称模糊查询/);
  assert.match(manualModule, /新用户注册后需先完成邮箱验证，再由管理员审核通过/);
  assert.match(manualModule, /最近 10 次登录记录/);
  assert.match(manualModule, /物流供应商仅可查看分配订单、提交物流费用并上传发票，不允许创建或删除大掌柜 Tracking/);
  assert.match(manualModule, /产品供应商仅可查看资料回传任务并上传工厂采购合同、增值税发票/);
});
