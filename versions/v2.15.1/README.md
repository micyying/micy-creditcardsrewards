# v2.15.1 — Chill 商戶規則與證據對帳

在既有 Trae app 的 v2.15.0 引擎上更新，保留原消費分欄、原始商戶文字、銀行實際金額及舊版入口。

- 5% 拆為 0.4% 基本積分與 4.6% 額外現金；10% 拆為 0.4% 與 9.6%。重疊取較高檔，額外現金共用每交易曆月 HK$150 上限。
- Chill World 的 10% 需同曆月合資格實體零售 HK$1,500，跨月結單累計。基本積分及額外現金保留既有零售金額取整估算。
- 商戶規則支援 effective_from / effective_to。2026 商戶名單與 5 月 1 日新增的 NOC、% Arabica、FINEPRINT、Logitech、Razer 分開記錄。只使用在有效期內的商戶規則。
- 商戶正規化僅用於匹配，保留原文字與 ##。舊 merchant_marker 自動遷移為 transaction_marker；marker_meaning=UNKNOWN、marker_confidence=PENDING。標記不參與資格、門檻或回贈率。
- Eternal East 保留 UNKNOWN／PENDING，不預設網上或 Chill，不計入已知實體門檻。基本積分僅為零售情境估算。其他非 Chill 商戶仍可因獨立網上／海外證據得到 5%。
- expected_cashback、observed_cashback_total、allocated_actual_cashback、confidence、evidence_count、reconciliation_status 分開保存。逐筆實際分配保持 null；理論封頂按交易順序分配並非實際銀行分配。
- 月度對帳讀取 CASH REBATE 描述的歸屬月份。使用者確認的 2026-07 HK$150 作為獨立 evidence，與同月銀行證據核對，不重複加總或捏造銀行入賬。
- MATCHED 表示月度數值相同；CAPPED_MATCH 表示理論至少 HK$150 且實際 HK$150，只能驗證封頂。缺實際為 INSUFFICIENT_DATA。所有未解釋差額（包括少於 HK$1）、缺交易或證據衝突為 UNRESOLVED；不為對數修改分類。
- 載入、同步、編輯與匯入後自動重算；不需要重新上傳月結單。預測明細與月度對帳彈窗顯示分離的數值及證據狀態。

## 規則範圍

依使用者最新確認規則，以及先前核對的中銀 2026 文件：
https://www.bochk.com/dam/boccreditcard/chillcard/chill_offer_tnc_tc.pdf

2026 以前／優惠期後缺少當期已核實名單，不倒套 2026 年 Chill 商戶 10%；仍給出既有一般／網上 0.4%／5% 情境數值，標記 LOW，並非已證實的歷史銀行資格。商戶名不等於 MCC；除 Eternal East 明確未知外，既有未知渠道仍按一般實體零售情境估算，可逐筆修改。門檻與上限只依已匯入資料；補入相鄰月結單會重算。既有增值／繳費排除與七日誌賬限制不變。退款未自動關聯原交易。

## 驗證與發佈

`node --test tests/*.test.cjs`：27 項測試，涵蓋 Apple、Nintendo、UNIQLO、McDonald's、Eternal East、## 不變性、日期邊界、HK$1,500 門檻、共享上限、證據去重與衝突、資料遷移、匯入與既有頁面。

27 份私人 Chill 月結單、576 筆消費另在本機重算；私人原單及歷史數值報告不加入公開倉庫。390px 手機瀏覽器驗證預測彈窗、分類修改、保存及版本載入。

建置：`node scripts/build-v2.15.1.mjs`。根目錄為新版；保留 `/versions/v2.15.0/` 及更早版本。
