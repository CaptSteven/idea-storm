import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const assets = join(root, "assets");
await mkdir(assets, { recursive: true });

const states = [
  ["sample-order-list.png", "orders"],
  ["sample-order-detail.png", "detail"],
  ["sample-refund-confirmation.png", "refund"],
  ["sample-campaign-list.png", "campaigns"],
];

const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
for (const [filename, view] of states) {
  await page.setContent(template(view));
  await page.screenshot({ path: join(assets, filename) });
}
await browser.close();
console.log(`Generated ${states.length} sample assets in ${assets}.`);

function template(view) {
  const content = view === "orders" ? orderList() : view === "detail" ? orderDetail() : view === "refund" ? refund() : campaigns();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#eef2f3;color:#16201e;font-family:Arial,"PingFang SC",sans-serif;font-size:14px}.shell{display:grid;grid-template-columns:220px 1fr;min-height:720px}.side{padding:24px 18px;background:#17211f;color:#fff}.logo{font-size:20px;font-weight:800;margin-bottom:34px}.logo span{color:#5ed0ad}.nav{display:grid;gap:7px}.nav div{padding:11px 12px;border-radius:6px;color:#b8c3c0}.nav .active{background:#28443d;color:#fff}.main{padding:24px 30px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}.top h1{margin:0;font-size:25px}.user{padding:9px 12px;border:1px solid #d7dfdd;background:#fff;border-radius:6px}.filters,.panel,.summary{border:1px solid #d7dfdd;background:#fff;border-radius:7px}.filters{display:flex;gap:10px;padding:14px;margin-bottom:14px}.filter{min-width:150px;padding:10px;border:1px solid #d7dfdd;border-radius:5px;color:#5e6b68}.button{padding:10px 16px;border-radius:5px;background:#08775f;color:#fff;font-weight:700}.panel{overflow:hidden}.panel-head{display:flex;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #d7dfdd;font-weight:700}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:14px 16px;border-bottom:1px solid #e3e8e7;text-align:left}.table th{background:#f6f8f8;color:#66736f;font-size:12px}.tag{display:inline-block;padding:5px 8px;border-radius:4px;background:#fff1d9;color:#8b5c0d;font-size:12px}.tag.green{background:#e5f3ee;color:#07634f}.tag.gray{background:#edf0f0;color:#5f6b68}.selected{background:#edf7f4}.link{color:#235f96;font-weight:700}.grid{display:grid;grid-template-columns:1.35fr .65fr;gap:15px}.section{padding:18px}.section h2{margin:0 0 16px;font-size:17px}.kv{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:11px 0;border-bottom:1px solid #e4e9e8}.kv span{color:#66736f}.summary{padding:18px}.amount{font-size:28px;font-weight:800}.notice{margin-top:14px;padding:12px;border-left:3px solid #9a6814;background:#fff4de}.success{display:grid;min-height:480px;place-items:center;text-align:center}.check{display:grid;width:62px;height:62px;margin:0 auto 18px;place-items:center;border-radius:50%;background:#dff2eb;color:#08775f;font-size:34px}.success h2{font-size:24px}.code{display:inline-block;margin:12px 0;padding:10px 16px;background:#eef2f3;font-family:monospace}.campaign{display:flex;align-items:center;gap:12px}.swatch{width:38px;height:38px;border-radius:6px;background:#235f96}.swatch.orange{background:#d87b2f}
  </style></head><body><div class="shell"><aside class="side"><div class="logo">MERCHANT<span> OPS</span></div><div class="nav"><div>概览</div><div class="${view.startsWith("order") || view === "detail" || view === "refund" ? "active" : ""}">订单管理</div><div class="${view === "campaigns" ? "active" : ""}">促销活动</div><div>商品库存</div><div>客户服务</div><div>数据报表</div></div></aside><main class="main"><header class="top"><h1>${view === "campaigns" ? "促销活动" : "订单管理"}</h1><div class="user">运营工作台 · 值班账号</div></header>${content}</main></div></body></html>`;
}

function orderList() {
  return `<div class="filters"><div class="filter">状态：退款待处理</div><div class="filter">提交时间：今天</div><div class="filter">渠道：全部</div><div class="button">筛选</div></div><section class="panel"><div class="panel-head"><span>退款待处理订单</span><span>共 18 条</span></div><table class="table"><thead><tr><th>订单编号</th><th>客户</th><th>金额</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr class="selected"><td>#10482</td><td>客户信息已隐藏</td><td>¥ 328.00</td><td>08:16</td><td><span class="tag">退款待处理</span></td><td class="link">查看订单</td></tr><tr><td>#10479</td><td>客户信息已隐藏</td><td>¥ 119.00</td><td>08:22</td><td><span class="tag">退款待处理</span></td><td class="link">查看订单</td></tr><tr><td>#10471</td><td>客户信息已隐藏</td><td>¥ 569.00</td><td>08:41</td><td><span class="tag">退款待处理</span></td><td class="link">查看订单</td></tr><tr><td>#10463</td><td>客户信息已隐藏</td><td>¥ 86.00</td><td>09:02</td><td><span class="tag">退款待处理</span></td><td class="link">查看订单</td></tr></tbody></table></section>`;
}

function orderDetail() {
  return `<div class="grid"><section class="panel section"><h2>订单 #10482</h2><div class="kv"><span>支付状态</span><strong><span class="tag green">已支付</span></strong></div><div class="kv"><span>订单金额</span><strong>¥ 328.00</strong></div><div class="kv"><span>退款原因</span><strong>商品尺寸与页面描述不一致</strong></div><div class="kv"><span>客户凭证</span><strong class="link">已上传 2 张图片</strong></div><div class="kv"><span>收货状态</span><strong>仓库已签收退件</strong></div></section><aside class="summary"><span>可退款金额</span><div class="amount">¥ 328.00</div><p>原路退回至支付账户</p><div class="notice">客户联系方式和支付凭证已自动隐藏。</div><div class="button" style="margin-top:18px;text-align:center">进入退款确认</div></aside></div>`;
}

function refund() {
  return `<section class="panel success"><div><div class="check">✓</div><h2>退款申请已提交</h2><p>系统已受理订单 #10482 的退款申请</p><div class="code">RF-20260716-01842</div><p>预计 1-3 个工作日原路退回</p><div class="button" style="display:inline-block;margin-top:12px">复制退款编号</div></div></section>`;
}

function campaigns() {
  return `<div class="filters"><div class="filter">状态：启用中</div><div class="filter">结束时间：今天</div><div class="button">查询</div></div><section class="panel"><div class="panel-head"><span>活动列表</span><span>4 个活动即将到期</span></div><table class="table"><thead><tr><th>活动</th><th>渠道</th><th>结束时间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr class="selected"><td><div class="campaign"><div class="swatch orange"></div><strong>夏季会员折扣</strong></div></td><td>全渠道</td><td>今天 23:59</td><td><span class="tag green">启用中</span></td><td class="link">查看设置</td></tr><tr><td><div class="campaign"><div class="swatch"></div><strong>新客首单优惠</strong></div></td><td>小程序</td><td>今天 23:59</td><td><span class="tag green">启用中</span></td><td class="link">查看设置</td></tr><tr><td><div class="campaign"><div class="swatch" style="background:#08775f"></div><strong>满额包邮</strong></div></td><td>官网</td><td>明天 12:00</td><td><span class="tag gray">待检查</span></td><td class="link">查看设置</td></tr></tbody></table></section>`;
}
