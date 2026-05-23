# trip-settlement-h5

出差记录、共同费用、交通票据和补贴结算 H5 工具。

## 云端同步

当前版本通过 Supabase 同步单个出差事项。负责人点击“分享任务”后，会把当前出差任务保存到 Supabase，并复制带 `?trip=...` 的链接。成员打开同一个链接填写后，数据会自动保存到同一条云端记录。

Supabase 前端配置在 `config.js`：

```js
export const SUPABASE_CONFIG = {
  url: "https://your-project.supabase.co",
  anonKey: "your-publishable-key",
};
```

这个 key 应使用 Supabase publishable key 或 anon public key，不要使用 service role/secret key。
