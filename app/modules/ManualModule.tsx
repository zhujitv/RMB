"use client";

import { useMemo, useState } from "react";
import styles from "../WorkspaceShell.module.css";
import { UPLOAD_REPLACE_TEXT } from "../uploadTexts";

type ManualSection = {
  id: string;
  no: string;
  title: string;
  summary: string;
  steps: string[];
  notes: string[];
  entry: string;
  defaultOpen?: boolean;
};

const FLOW_STEPS = [
  ["应收订单", "建立一票业务的主档案"],
  ["收款管理", "登记客户回款和到账状态"],
  ["成本管理", "录入工厂、物流和其它费用"],
  ["物流信息", "维护物流状态、资料和费用审核"],
  ["退税资料", "汇总资料并检查完整度"],
  ["提交退税", "完整度 100% 后递交"],
  ["自动归档", "已提交资料进入档案"],
  ["档案查询", "历史资料随时调取"],
];

const SECTIONS: ManualSection[] = [
  {
    id: "positioning",
    no: "01",
    title: "系统定位",
    summary: "本系统用于管理外贸业务从应收订单、客户回款、成本录入、物流资料、退税资料收集，到退税提交和资料归档的全过程。",
    steps: ["一票业务 = 一个订单。", "所有收款、成本、物流资料、退税资料都必须围绕订单管理。"],
    notes: ["不要把资料分散到微信、邮箱或本地文件夹里。"],
    entry: "全平台",
    defaultOpen: true,
  },
  {
    id: "process",
    no: "02",
    title: "业务流程",
    summary: "标准流程从建立应收订单开始，最终以退税资料提交并自动归档结束。",
    steps: ["建立应收订单", "登记客户回款", "录入成本费用", "录入物流信息", "汇总退税资料", "检查总体完整度", "提交退税", "自动归档", "后续在档案中查询"],
    notes: ["每个环节都要关联同一个订单。"],
    entry: "左侧业务菜单",
    defaultOpen: true,
  },
  {
    id: "orders",
    no: "03",
    title: "应收订单",
    summary: "业务员负责创建应收订单，并确认订单号、客户、币种、金额、付款条款和提单信息。",
    steps: ["选择客户并核对客户名称。", "填写订单号、提单号、币种、汇率和最终应收金额。", "确认付款条款、发货时间、提单日期、到期日和订单状态。"],
    notes: ["订单号必须唯一。", "客户名称统一大写。", "后续收款、成本、物流、退税都会关联该订单。"],
    entry: "应收订单",
  },
  {
    id: "payments",
    no: "04",
    title: "收款管理",
    summary: "财务负责登记客户实际回款，并确认是否已到账。",
    steps: ["选择订单。", "录入收款日期、金额、币种、汇率和银行流水。", "确认收款状态。"],
    notes: ["只有已到账收款进入正式统计。", "退税归档不会影响收款管理，尾款未收仍可继续登记。"],
    entry: "收款管理",
  },
  {
    id: "costs",
    no: "05",
    title: "成本管理",
    summary: "成本管理用于记录每票订单产生的工厂货款、物流费用、手续费、佣金和其它费用；物流类成本按发票组 / Shipment 组展示，避免一张发票被拆成多行。",
    steps: ["选择订单和供应商。", "录入成本类型、金额、币种和汇率。", "在成本列表查看订单号、客户简称、供应商、CNY 合计、USD 合计、付款状态和发票状态。", "点击详情或资料维护查看发票号、文件名、包含费用类型和明细资料。", "维护付款状态、成本确认和发票状态。"],
    notes: ["成本确认后才进入正式利润分析。", "物流供应商上传的发票以物流费用分组开票为主，成本管理只同步展示结果。", "客户指定临时货代或手工录入的物流成本，可在成本管理维护对应物流发票。", "默认只显示当前业务，已归档业务可通过筛选查询。"],
    entry: "成本管理",
  },
  {
    id: "domestic-logistics",
    no: "06",
    title: "物流信息",
    summary: "物流信息集中维护物流状态、首程运输事实数据和报关资料；运输监控作为物流信息下的在途海运监控入口。",
    steps: ["选择车辆运输、快递运输、多式联运或散货进舱，并填写对应运输/进舱信息。", "系统生成退税资料所需运输备注。", "上传报关单、放行通知书、报关委托书。", "报关单 PDF 上传成功后，系统自动识别报关单号和申报日期，并同步到退税资料。", "点击费用录入状态或“录入费用”时，系统切换到左侧菜单“物流费用”并定位对应订单或提单。"],
    notes: ["物流费用录入、月结汇总、合并审核、发票分组上传、付款状态和对账单导出统一在左侧菜单“物流费用”中完成。", "物流资料上传后自动归属到订单，并进入退税资料统计。", "报关单只保留一个当前有效 PDF，重新上传会替换旧文件。", "如果识别失败，不影响文件上传，可在退税资料详情中手工填写或重新识别。"],
    entry: "物流信息",
  },
  {
    id: "logistics-fees",
    no: "07",
    title: "物流费用",
    summary: "物流费用用于维护供应商费用账单、月结汇总、合并审核、发票分组和付款状态。",
    steps: ["在左侧菜单点击“物流费用”。", "使用查询、状态、费用类型筛选定位订单或提单。", "点击“新增物流费用”登记供应商费用，物流供应商账号会自动绑定自身供应商。", "在费用账单列表中展开详情，维护费用明细、发票分组和付款状态。", "对待审核费用执行合并审核 / 批量审核，并按供应商合并发送开票通知。", "需要对账时导出物流费用月结对账单。"],
    notes: ["物流费用页面沿用原有接口、权限和数据结构，只是从物流信息底部迁移为独立菜单。", "审核、开票、付款状态以物流账单为单位流转，不按单条费用明细单独审核。", "CNY 与 USD 金额分开显示、分开合计，不混合折算为一个金额。"],
    entry: "物流费用",
  },
  {
    id: "transport-monitor",
    no: "08",
    title: "运输监控",
    summary: "运输监控用于集中查看已创建大掌櫃跟踪且尚未到港的在途海运业务，帮助业务和物流人员快速关注 ETA、异常同步和运输节点。",
    steps: ["在左侧工作树“物流信息”下点击“运输监控”，系统默认打开全屏监控视图。", "查看顶部统计：在途总票数、即将到港、ETA 已过期、同步失败和今日已同步。", "按订单号、客户简称、Master B/L、船公司、起运港、目的港、状态、ETA 日期范围筛选。", "点击“查看运输节点”展开时间轴，查看节点时间、地点、状态描述、船名航次和数据来源。", "点击“同步最新状态”时，只同步本地已有的大掌櫃 Tracking ID，不会创建新的跟踪。", "需要进一步处理时，可使用“查看地图”或“跳转物流详情”。", "按 Esc 或点击“退出全屏”返回普通视图。"],
    notes: ["管理员可查看全部大掌櫃海运跟踪；业务员仅查看本人负责订单；物流供应商仅查看被分配订单；产品供应商不可见。", "运输监控默认只显示未到港 / 未完成的在途业务，已到港或已完成记录可通过筛选查看。", "一张 Master B/L 在系统生命周期内只创建一次大掌櫃 Tracking；柜号只用于本地关联查询，避免重复消耗 Credit。", "后台页面优先显示中文船公司、港口、状态和跟踪方式，原始英文数据仍保留在系统中。"],
    entry: "物流信息 → 运输监控",
  },
  {
    id: "tax-refunds",
    no: "09",
    title: "退税资料",
    summary: "退税资料模块按订单汇总出口资料、报关资料、产品供应商资料、物流资料和物流信息，并在详情页集中完成资料补齐、预览、下载、删除和提交。",
    steps: ["查看列表中的申报日期、总体完整度和退税状态。", "点击详情进入退税资料详情弹窗。", "在出口资料上传和报关资料上传区域，按资料卡片上传 PDF。", "通知产品供应商回传工厂采购合同和工厂增值税发票 PDF。", "已上传资料可直接预览、下载、删除或替换当前 PDF。", "报关单可点击重新识别报关单，识别结果会回填报关单号和申报日期。", "确认总体完整度 100% 后提交退税。"],
    notes: ["列表只保留总体完整度，分类明细在详情弹窗中处理。", "出口资料和报关资料使用统一卡片格式，每个资料类型只显示一个当前有效 PDF。", `PDF 上传按钮统一显示“${UPLOAD_REPLACE_TEXT}”。`, "产品供应商端只看到资料回传任务，不显示客户简称或客户全称。", "删除报关单会同步清空报关单号和申报日期。", "总体完整度不足 100% 不允许提交退税。"],
    entry: "退税资料",
  },
  {
    id: "archive",
    no: "10",
    title: "提交退税与归档",
    summary: "当用户操作已提交退税时，系统自动执行归档。",
    steps: ["提交前检查总体完整度。", "完整度 100% 后提交退税。", "提交成功后自动进入退税档案。"],
    notes: ["归档不是删除。", "归档后的订单默认不再显示在当前退税资料、成本管理、物流信息当前业务和经营待处理提醒中。", "退税归档只代表资料链完成，不代表货款已经收齐。"],
    entry: "退税资料 → 退税档案",
    defaultOpen: true,
  },
  {
    id: "reports",
    no: "11",
    title: "报表中心",
    summary: "报表中心用于在线查询业务数据，并在确认范围后按需下载。",
    steps: ["选择报表类型。", "填写筛选条件并查询。", "在线查看、勾选数据。", "下载当前页、已勾选或当前查询结果。"],
    notes: ["日常查询默认当前业务。", "历史查询可以选择已归档业务或全部业务。"],
    entry: "报表中心",
  },
  {
    id: "settings",
    no: "12",
    title: "系统设置",
    summary: "管理员维护公司资料、系统品牌、汇率、客户、供应商、用户权限和操作日志。",
    steps: ["在公司资料中维护品牌名称、系统名称、中英文公司名称和联系方式。", "维护客户资料和负责业务员。", "按供应商类型配置产品供应商资料回传权限，以及物流供应商费用录入、发票上传和费用类型权限。", "维护物流费用开票通知模板、抄送邮箱和公司品牌配置。", "维护大掌櫃接口开关、API Key、Webhook Secret、手动同步和每日自动同步设置。", "维护用户角色、权限和账号状态。", "查看操作日志追溯关键修改。"],
    notes: ["公司资料会影响登录页品牌、工作台侧边栏、首页欢迎语、Logo 和页脚版权等系统展示。", "汇率影响所有外币折人民币金额。", "客户资料中的业务员和提成比例会影响利润与提成统计。", "用户权限决定能看到哪些模块。", "产品供应商只用于资料回传；物流类供应商账号用于物流资料、费用和发票相关操作。", "大掌櫃关闭后，物流信息和运输监控不显示相关创建、同步和查看入口。"],
    entry: "系统设置",
  },
  {
    id: "security",
    no: "13",
    title: "账号与安全",
    summary: "系统按角色和数据范围控制可见模块、附件操作、财务数据和后台设置，管理员负责账号开通、停用和权限维护。",
    steps: ["使用系统正式网址进入登录页。", "管理员在系统设置中维护用户角色、账号状态和供应商绑定。", "上传 PDF 前确认文件来源可信。", "遇到“请求来源不合法”或“缺少请求来源校验信息”时，返回系统正式页面重新操作。"],
    notes: ["业务员、财务、物流供应商、产品供应商和管理员看到的模块不同，不要借用他人账号操作。", "所有业务附件上传入口统一只支持 PDF，单个文件最大 5MB，选择文件后自动上传并显示进度。", "文件预览、下载、删除均受权限控制。", "登录失败和系统错误会记录安全日志，但不会在页面暴露数据库、密钥或部署细节。"],
    entry: "登录页 / 系统设置 / 文件上传区域",
  },
  {
    id: "daily-notes",
    no: "14",
    title: "日常注意事项",
    summary: "保存业务数据前先核对订单号、客户、币种、金额和付款条款。",
    steps: ["所有收款、成本、物流、退税资料必须关联订单。", "成本未确认时，不应进入最终利润结算。", "物流费用在独立“物流费用”菜单中维护，物流信息页面仅保留物流列表和运输监控。", "总体完整度不足 100%，不允许提交退税。", "任何关键修改都必须写入操作日志。", "不要上传来源不明的 PDF 附件。"],
    notes: ["已提交退税后自动归档。", "归档不是删除，只是放入档案室。", "收款未完成不影响退税归档。", "退税归档不等于订单关闭。", "如需调整权限或删除错误附件，请联系管理员按角色权限处理。"],
    entry: "全平台",
  },
];

export function ManualModule() {
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(() => (
    new Set(SECTIONS.filter((section) => section.defaultOpen).map((section) => section.id))
  ));

  const normalizedQuery = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!normalizedQuery) return SECTIONS;
    return SECTIONS.filter((section) => sectionText(section).toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery]);

  function toggleSection(id: string) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenSections(new Set(SECTIONS.map((section) => section.id)));
  }

  function collapseAll() {
    setOpenSections(new Set());
  }

  function scrollToSection(id: string) {
    setOpenSections((current) => new Set(current).add(id));
    requestAnimationFrame(() => {
      document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <section className={styles.manualPage}>
      <div className={styles.manualHero}>
        <div>
          <span className={styles.kicker}>NEXTWOOD Handbook</span>
          <h2>操作手册</h2>
          <p>供应链业务、单证、物流费用与退税资料协同平台操作手册</p>
          <div className={styles.manualMeta}>
            <span>当前版本：v2.4</span>
            <span>适用对象：业务 / 财务 / 成本 / 物流 / 管理员</span>
            <span>更新时间：{new Date().toLocaleDateString("zh-CN")}</span>
          </div>
        </div>
        <div className={styles.manualHeroBadge}>
          <strong>一票业务</strong>
          <span>一个订单 · 一套资料 · 一次归档</span>
        </div>
      </div>

      <div className={styles.manualToolbar}>
        <label>
          <span>搜索手册</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节、操作步骤、注意事项" />
        </label>
        <div>
          <button className={styles.secondaryButton} type="button" onClick={expandAll}>展开全部</button>
          <button className={styles.secondaryButton} type="button" onClick={collapseAll}>收起全部</button>
        </div>
      </div>

      <div className={styles.manualFlow}>
        {FLOW_STEPS.map(([title, text], index) => (
          <div key={title} className={styles.manualFlowCard}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{title}</strong>
            <small>{text}</small>
          </div>
        ))}
      </div>

      <div className={styles.manualLayout}>
        <aside className={styles.manualToc}>
          {SECTIONS.map((section) => (
            <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>
              {section.no} {section.title}
            </button>
          ))}
        </aside>

        <div className={styles.manualContent}>
          {sections.length ? sections.map((section) => (
            <article key={section.id} id={`manual-${section.id}`} className={styles.manualSectionCard}>
              <button type="button" onClick={() => toggleSection(section.id)}>
                <span>{section.no}</span>
                <strong>{highlight(section.title, query)}</strong>
                <i>{openSections.has(section.id) ? "收起" : "展开"}</i>
              </button>
              {openSections.has(section.id) ? (
                <div className={styles.manualSectionBody}>
                  <p>{highlight(section.summary, query)}</p>
                  <div className={styles.manualSectionGrid}>
                    <div>
                      <h4>关键操作</h4>
                      <ul>{section.steps.map((item) => <li key={item}>{highlight(item, query)}</li>)}</ul>
                    </div>
                    <div>
                      <h4>注意事项</h4>
                      <ul>{section.notes.map((item) => <li key={item}>{highlight(item, query)}</li>)}</ul>
                    </div>
                  </div>
                  <p className={styles.manualEntryTip}>相关入口：{section.entry}</p>
                </div>
              ) : null}
            </article>
          )) : (
            <div className={styles.emptyState}>未找到匹配的手册内容</div>
          )}
        </div>
      </div>

      <button className={styles.manualBackTop} type="button" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
        返回顶部
      </button>
    </section>
  );
}

function sectionText(section: ManualSection) {
  return [section.title, section.summary, ...section.steps, ...section.notes, section.entry].join(" ");
}

function highlight(text: string, query: string) {
  const value = String(text || "");
  const keyword = query.trim();
  if (!keyword) return value;
  const index = value.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + keyword.length)}</mark>
      {value.slice(index + keyword.length)}
    </>
  );
}
