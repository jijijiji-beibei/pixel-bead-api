<?php
/**
 * 拼豆坐标图生成器 - 密钥激活回调
 * 在 vfkphp 发卡成功后调用
 */

function pixelBeadActivate($cards) {
    $apiUrl = 'https://pixel-bead-api-rp8a.vercel.app/api/activate';
    foreach ($cards as $card) {
        $key = trim($card['content']);
        if (empty($key)) continue;
        $payload = json_encode(['key' => $key]);
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $apiUrl,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }
}
