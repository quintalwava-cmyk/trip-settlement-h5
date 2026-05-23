# 部署说明

这个项目是静态网页，入口文件是 `index.html`。多人共享填写的数据同步到 Supabase。

## 重要：多人共享填写需要 Supabase

现在应用已经支持负责人生成分享链接，成员打开同一个链接填写同一份云端任务数据。这个能力依赖：

- `config.js` 中的 Supabase URL 和 publishable key
- Supabase 表 `public.trips`

Supabase 表结构：

```sql
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  cloud_id text not null unique,
  owner_key text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trips enable row level security;

create policy "Allow public read trips by link"
on public.trips
for select
to anon
using (true);

create policy "Allow public create trips"
on public.trips
for insert
to anon
with check (true);

create policy "Allow public update trips"
on public.trips
for update
to anon
using (true)
with check (true);
```

## 静态预览：Netlify Drop

1. 打开 https://app.netlify.com/drop
2. 将整个项目文件夹拖进去，或压缩成 zip 后上传。
3. 等待部署完成，Netlify 会生成一个公网地址。

只要 `config.js` 配置正确，这种方式也可以连接 Supabase。

## 推荐正式测试：Netlify + GitHub

1. 新建 GitHub 仓库。
2. 上传本目录所有文件。
3. 在 Netlify 选择 `Add new site` -> `Import an existing project`。
4. 连接 GitHub 仓库。
5. Build command 使用：

```bash
echo 'static app'
```

6. Publish directory 使用：

```text
.
```

7. 部署完成后，打开站点，负责人点击 `分享任务`，把生成的链接发给成员。

## 成员填写流程

1. 负责人新建出差任务。
2. 点击 `分享任务`。
3. 系统生成并复制一个带 `?trip=...` 的链接。
4. 成员打开这个链接。
5. 成员填写自己的实际出差信息。
6. 页面会自动保存到云端任务。
7. 负责人打开同一个链接查看汇总并导出。

## GitHub Pages

1. 新建一个 GitHub 仓库。
2. 上传本目录所有文件。
3. 进入仓库 `Settings` -> `Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待生成公网地址。

## 当前版本的重要限制

云端任务没有登录和权限控制。拿到链接的人都可以查看和修改这条任务，适合小团队内部测试。
