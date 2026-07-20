# 拼豆坐标图生成器 + vfkphp 发卡系统 对接指南

## 整体架构

```
Upstash KV (白名单+激活时间)        vfkphp (发卡系统)
       ^                                    ^
       |  POST /api/activate                |  支付后发货
       |                                    |
       +---------- Vercel API --------------+
                      ^
                      |  POST /api/verify
                      |
                 用户浏览器
```

## 一、部署 vfkphp

### 1. 下载
git clone https://github.com/szvone/vfkphp.git

### 2. 服务器要求
- PHP 7.3+ (需要 curl 扩展)
- MySQL 5.6+
- Nginx / Apache

### 3. 安装步骤
1. 上传 vfkphp 文件夹到服务器
2. 导入数据库：执行 vfkphp.sql
3. 修改 config/database.php 数据库连接信息
4. 配置伪静态（Nginx 参考 vfkphp 文档）
5. 访问 http://你的域名/ 看到发卡站首页
6. 访问 http://你的域名/admin.html 进入后台，默认账号密码：admin / 123456

## 二、在 vfkphp 后台创建商品

1. 分类管理 -> 添加分类（如"拼豆密钥"）
2. 商品管理 -> 添加商品：
   - 名称：24小时拼豆密钥
   - 分类：拼豆密钥
   - 价格：你的定价
   - 库存：0（后续通过卡密导入）
3. 卡密管理 -> 添加卡密：
   - 选择商品
   - 输入密钥内容（每行一个密钥）
   - 点击添加

## 三、准备 Upstash KV 白名单

在 Vercel Dashboard 中：
1. 进入 Storage -> KV -> pixel-bead-api
2. 点击 Data -> Add Row
3. 添加密钥，Key格式：valid:你的密钥
   例如：valid:PEBBLE001 -> Value: 1
4. 点击 Save

## 四、对接激活回调

### 1. 复制回调文件
将 pixel_bead_callback.php 放到：
vfkphp/application/index/controller/pixel_bead_callback.php

### 2. 修改 Index.php
编辑 application/index/controller/Index.php
在 payReturn() 和 payNotify() 两个方法中，
找到卡密发货完成的代码（约第340行）：

```php
// 在以下代码之后（原有的）
Db::name('orders')->where('id',$order['id'])->update(array('cards'=>$card));

// 添加以下两行
require_once __DIR__ . '/pixel_bead_callback.php';
pixelBeadActivate($cards);
```

## 五、配置支付

vfkphp 支持码支付（推荐个人使用）：
1. 注册码支付平台
2. 获取商户ID和通讯密钥
3. 在 vfkphp 的 config 中配置支付参数

## 六、测试全流程

1. 在 Upstash 添加 valid:TEST001 = 1
2. 在 vfkphp 后台导入 TEST001 到商品库存
3. 访问发卡站 -> 购买 -> 支付
4. 支付成功后页面显示密钥
5. 打开拼豆工具 -> 输入 TEST001 -> 验证成功

## 七、常用API测试

```bash
# 激活密钥（发卡站发货时调用）
curl -X POST https://pixel-bead-api-rp8a.vercel.app/api/activate \
  -H "Content-Type: application/json" \
  -d '{"key":"TEST001"}'

# 验证密钥（用户在拼豆工具中使用）
curl -X POST https://pixel-bead-api-rp8a.vercel.app/api/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"TEST001"}'
```

## 八、注意事项

1. 密钥需要在 Upstash（valid:KEY）和 vfkphp（卡密）两边都添加
2. 建议用脚本批量生成密钥，同时写入两边
3. 如果用户退款，需手动从 Upstash 删除 activation:KEY
4. 验证状态缓存1小时，过期自动清理（TTL=30天）
