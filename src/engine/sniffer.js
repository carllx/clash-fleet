/**
 * Sniffer 嗅探配置与注入模块
 *
 * 依据 Clash Fleet 架构规范与 CVR 实测最佳实践，
 * 强制开启域名嗅探 (解决 Chrome / 现代浏览器 DoH 与 DNS 缓存导致的纯 IP 请求漏网问题)。
 */

export const DEFAULT_SNIFFER_CONFIG = {
  enable: true,
  'parse-pure-ip': true,
  sniff: {
    TLS: {
      ports: [443, 8443],
    },
    HTTP: {
      ports: [80, '8080-8880'],
    },
  },
};

/**
 * 注入 Fleet 拥有的 Sniffer 嗅探配置
 *
 * 保持纯函数/浅拷贝友好原则，仅修饰 config.sniffer 字段，
 * 绝不侵入或修改 TUN、DNS、本地端口等 CVR 权威控制面。
 *
 * @param {object} config 待增强的配置对象
 * @returns {object} 注入后的配置对象
 */
export function injectSniffer(config) {
  if (!config || typeof config !== 'object') {
    config = {};
  }

  var existingSniffer = config.sniffer || {};
  var existingSniff = existingSniffer.sniff || {};

  var mergedSniff = {};
  for (var sniffKey in existingSniff) {
    mergedSniff[sniffKey] = existingSniff[sniffKey];
  }
  mergedSniff.TLS = existingSniff.TLS || DEFAULT_SNIFFER_CONFIG.sniff.TLS;
  mergedSniff.HTTP = existingSniff.HTTP || DEFAULT_SNIFFER_CONFIG.sniff.HTTP;

  config.sniffer = {
    enable: true,
    'parse-pure-ip': true,
    sniff: mergedSniff,
  };

  // 保留用户或配置原有的其他合法 sniffer 选项 (如 force-dns-mapping, override-destination 等)
  for (var key in existingSniffer) {
    if (key !== 'enable' && key !== 'parse-pure-ip' && key !== 'sniff') {
      config.sniffer[key] = existingSniffer[key];
    }
  }

  return config;
}
