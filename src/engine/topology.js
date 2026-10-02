/**
 * 三级策略组拓扑装配引擎 (Three-Tier Policy Topology Engine)
 *
 * 核心架构：
 * - Tier 1: 业务意图层 ('select') - 规则路由与用户手动干预入口 (如 🔰 节点选择)
 * - Tier 1.5: 调度优选层 ('fallback') - 仅按需引用 Tier 2 地区组名，严禁直接绑定物理节点，避免额外探测
 * - Tier 2: 物理地区池 ('url-test') - 绑定具体物理节点的真实 proxy.name 并执行单点健康探测；空地区自动裁剪
 *
 * 幂等性与引用完整性：
 * - 多次装配不会产生重复的 Fleet 托管策略组；
 * - 安全保留用户自定义/非 Fleet 托管的既有策略组；
 * - 剔除对已被裁剪空地区的悬空引用 (Dangling References)。
 */

import { classifyProxies } from './proxy-classifier.js';

/**
 * 默认健康探测参数常量
 */
var DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204';
var DEFAULT_INTERVAL = 300;
var DEFAULT_TEST_TOLERANCE = 50;

/**
 * 获取某个地区的标准策略组显示名称 (如 '🇭🇰 香港')
 *
 * @param {object} regionDef 地区定义 (含 name, emoji)
 * @returns {string} 标准组名
 */
export function formatRegionGroupName(regionDef) {
  if (!regionDef) return '';
  var emoji = regionDef.emoji ? regionDef.emoji + ' ' : '';
  return emoji + (regionDef.name || '');
}

/**
 * 组装三级分层策略组拓扑
 *
 * @param {Array} proxies 经清洗去重后的代理节点列表
 * @param {object} regionPresets 声明式地区正则字典
 * @param {Array} [existingProxyGroups] 订阅或原有配置中的策略组列表
 * @returns {Array} 组装完成的策略组列表
 */
export function assembleTopology(proxies, regionPresets, existingProxyGroups) {
  var classified = classifyProxies(proxies, regionPresets);
  var buckets = classified.buckets;

  var tier2Groups = [];
  var validTier2Names = [];
  var prunedFleetGroupNames = {};
  var allKnownFleetGroupNames = {
    '🔰 节点选择': true,
    '🚀 自动优选': true,
  };

  // 1. 构建 Tier 2 物理地区池
  if (regionPresets && typeof regionPresets === 'object') {
    var regionKeys = Object.keys(regionPresets);
    for (var i = 0; i < regionKeys.length; i++) {
      var key = regionKeys[i];
      var regionDef = regionPresets[key];
      var groupName = formatRegionGroupName(regionDef);
      allKnownFleetGroupNames[groupName] = true;

      var matchedProxies = buckets[key] || [];
      // 动态裁剪：仅当节点数 > 0 时才生成该地区池
      if (matchedProxies.length > 0) {
        var proxyNames = [];
        for (var p = 0; p < matchedProxies.length; p++) {
          if (matchedProxies[p] && matchedProxies[p].name) {
            proxyNames.push(matchedProxies[p].name);
          }
        }

        tier2Groups.push({
          name: groupName,
          type: 'url-test',
          url: DEFAULT_TEST_URL,
          interval: DEFAULT_INTERVAL,
          tolerance: DEFAULT_TEST_TOLERANCE,
          proxies: proxyNames,
        });

        validTier2Names.push(groupName);
      } else {
        // 标记该预置地区组被裁剪
        prunedFleetGroupNames[groupName] = true;
      }
    }
  }

  // 2. 构建 Tier 1.5 调度优选层 (按需创建：仅在有效地区池数量 >= 2 时创建，严禁单地区制造无意义调度组)
  var tier15Groups = [];
  var hasTier15 = false;
  var autoSelectGroupName = '🚀 自动优选';

  if (validTier2Names.length >= 2) {
    // 硬性约束：Tier 1.5 仅包含有效的 Tier 2 组名
    var autoSelectProxies = [];
    for (var a = 0; a < validTier2Names.length; a++) {
      autoSelectProxies.push(validTier2Names[a]);
    }

    tier15Groups.push({
      name: autoSelectGroupName,
      type: 'fallback',
      url: DEFAULT_TEST_URL,
      interval: DEFAULT_INTERVAL,
      proxies: autoSelectProxies,
    });
    hasTier15 = true;
  }

  // 3. 构建 Tier 1 业务意图层 (基线意图组：🔰 节点选择)
  var tier1Proxies = [];
  if (hasTier15) {
    tier1Proxies.push(autoSelectGroupName);
  }
  for (var t2 = 0; t2 < validTier2Names.length; t2++) {
    tier1Proxies.push(validTier2Names[t2]);
  }

  // 保底追加 DIRECT
  tier1Proxies.push('DIRECT');

  var tier1Groups = [
    {
      name: '🔰 节点选择',
      type: 'select',
      proxies: tier1Proxies,
    },
  ];

  // 4. 幂等性合并：保留用户既有的非 Fleet 策略组，并清洗对已裁剪地区的失效引用
  var preservedUserGroups = [];
  if (Array.isArray(existingProxyGroups)) {
    for (var g = 0; g < existingProxyGroups.length; g++) {
      var oldGroup = existingProxyGroups[g];
      if (!oldGroup || typeof oldGroup !== 'object' || !oldGroup.name) {
        continue;
      }
      // 若不是 Fleet 拥有的策略组，予以保留并净化引用
      if (!allKnownFleetGroupNames[oldGroup.name]) {
        var cleanedProxies = [];
        if (Array.isArray(oldGroup.proxies)) {
          for (var pi = 0; pi < oldGroup.proxies.length; pi++) {
            var targetName = oldGroup.proxies[pi];
            // 剔除已被裁剪的 Fleet 地区池组名
            if (!prunedFleetGroupNames[targetName]) {
              cleanedProxies.push(targetName);
            }
          }
        }
        var cleanedGroup = {
          name: oldGroup.name,
          type: oldGroup.type,
          proxies: cleanedProxies,
        };
        // 复制其余非标准属性
        var groupKeys = Object.keys(oldGroup);
        for (var gk = 0; gk < groupKeys.length; gk++) {
          var kName = groupKeys[gk];
          if (kName !== 'name' && kName !== 'type' && kName !== 'proxies') {
            cleanedGroup[kName] = oldGroup[kName];
          }
        }
        preservedUserGroups.push(cleanedGroup);
      }
    }
  }

  // 5. 组合全部策略组
  var combined = [];
  for (var c1 = 0; c1 < tier1Groups.length; c1++) combined.push(tier1Groups[c1]);
  for (var c15 = 0; c15 < tier15Groups.length; c15++) combined.push(tier15Groups[c15]);
  for (var c2 = 0; c2 < tier2Groups.length; c2++) combined.push(tier2Groups[c2]);
  for (var cu = 0; cu < preservedUserGroups.length; cu++) combined.push(preservedUserGroups[cu]);

  return combined;
}
