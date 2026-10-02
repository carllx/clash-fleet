import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleRules } from '../src/engine/rules.js';

test('Migration Behavior & Rule Precedence Suite', async (t) => {
  await t.test('assembles rule hierarchy in exact deterministic priority order', () => {
    var declarativeRules = {
      rejectRules: ['DOMAIN-SUFFIX,ad.example.com,REJECT'],
      darwinRules: ['PROCESS-NAME,DingTalk.app,DIRECT'],
      win32Rules: ['PROCESS-NAME,DingTalk.exe,DIRECT'],
      aiRules: [
        'DOMAIN,api2.cursor.sh,DIRECT',
        'DOMAIN-SUFFIX,cursor.sh,🤖 AI 服务',
        'DOMAIN,accounts.google.com,🤖 AI 服务',
      ],
      mediaRules: ['DOMAIN-SUFFIX,spotify.com,🎵 媒体服务'],
      directRules: ['DOMAIN-SUFFIX,cnki.net,DIRECT'],
    };

    var downstreamRules = [
      'GEOIP,CN,DIRECT',
      'MATCH,🔰 节点选择',
    ];

    var assembled = assembleRules(downstreamRules, declarativeRules);

    // Assert exact order:
    // 1. Reject
    // 2. AI & OAuth
    // 3. Darwin process
    // 4. Win32 process
    // 5. Media
    // 6. Direct
    // 7. Downstream
    assert.deepEqual(assembled, [
      'DOMAIN-SUFFIX,ad.example.com,REJECT',
      'DOMAIN,api2.cursor.sh,DIRECT',
      'DOMAIN-SUFFIX,cursor.sh,🤖 AI 服务',
      'DOMAIN,accounts.google.com,🤖 AI 服务',
      'PROCESS-NAME,DingTalk.app,DIRECT',
      'PROCESS-NAME,DingTalk.exe,DIRECT',
      'DOMAIN-SUFFIX,spotify.com,🎵 媒体服务',
      'DOMAIN-SUFFIX,cnki.net,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,🔰 节点选择',
    ]);
  });

  await t.test('sensitive AI & OAuth rules precede platform PROCESS DIRECT rules', () => {
    var declarativeRules = {
      aiRules: [
        'DOMAIN,accounts.google.com,🤖 AI 服务',
        'DOMAIN,oauth2.googleapis.com,🤖 AI 服务',
      ],
      darwinRules: [
        'PROCESS-NAME,DingTalk.app,DIRECT',
        'PROCESS-NAME,BrowserHelper,DIRECT',
      ],
      win32Rules: [
        'PROCESS-NAME,DingTalk.exe,DIRECT',
      ],
    };

    var assembled = assembleRules([], declarativeRules);

    var accountsIdx = assembled.indexOf('DOMAIN,accounts.google.com,🤖 AI 服务');
    var oauthIdx = assembled.indexOf('DOMAIN,oauth2.googleapis.com,🤖 AI 服务');
    var darwinProcessIdx = assembled.indexOf('PROCESS-NAME,DingTalk.app,DIRECT');
    var win32ProcessIdx = assembled.indexOf('PROCESS-NAME,DingTalk.exe,DIRECT');

    assert.ok(accountsIdx !== -1);
    assert.ok(oauthIdx !== -1);
    assert.ok(darwinProcessIdx !== -1);
    assert.ok(win32ProcessIdx !== -1);

    // AI & OAuth must precede PROCESS DIRECT rules
    assert.ok(accountsIdx < darwinProcessIdx, 'accounts.google.com must precede darwin PROCESS-NAME DIRECT');
    assert.ok(oauthIdx < darwinProcessIdx, 'oauth2.googleapis.com must precede darwin PROCESS-NAME DIRECT');
    assert.ok(accountsIdx < win32ProcessIdx, 'accounts.google.com must precede win32 PROCESS-NAME DIRECT');
  });

  await t.test('sensitive AI & OAuth routes precede broad DIRECT and downstream rules', () => {
    var declarativeRules = {
      aiRules: [
        'DOMAIN,accounts.google.com,🤖 AI 服务',
        'DOMAIN,oauth2.googleapis.com,🤖 AI 服务',
        'DOMAIN,gemini.google.com,🤖 AI 服务',
      ],
      directRules: [
        'DOMAIN-SUFFIX,google.com,DIRECT', // 假设用户自定义直连了某些 google 域名
      ],
    };

    var downstreamRules = ['GEOIP,CN,DIRECT'];

    var assembled = assembleRules(downstreamRules, declarativeRules);

    var accountsIdx = assembled.indexOf('DOMAIN,accounts.google.com,🤖 AI 服务');
    var oauthIdx = assembled.indexOf('DOMAIN,oauth2.googleapis.com,🤖 AI 服务');
    var geminiIdx = assembled.indexOf('DOMAIN,gemini.google.com,🤖 AI 服务');
    var directGoogleIdx = assembled.indexOf('DOMAIN-SUFFIX,google.com,DIRECT');

    assert.ok(accountsIdx !== -1);
    assert.ok(oauthIdx !== -1);
    assert.ok(geminiIdx !== -1);
    assert.ok(directGoogleIdx !== -1);

    // AI & OAuth rules MUST precede the broad direct rule to avoid leaking sensitive auth traffic
    assert.ok(accountsIdx < directGoogleIdx, 'accounts.google.com must precede directGoogle');
    assert.ok(oauthIdx < directGoogleIdx, 'oauth2.googleapis.com must precede directGoogle');
    assert.ok(geminiIdx < directGoogleIdx, 'gemini.google.com must precede directGoogle');
  });

  await t.test('specific Cursor bypass precedes broad cursor.sh AI rule', () => {
    var declarativeRules = {
      aiRules: [
        'DOMAIN,api2.cursor.sh,DIRECT',
        'DOMAIN-SUFFIX,cursor.sh,🤖 AI 服务',
      ],
    };

    var assembled = assembleRules([], declarativeRules);

    var api2Idx = assembled.indexOf('DOMAIN,api2.cursor.sh,DIRECT');
    var cursorIdx = assembled.indexOf('DOMAIN-SUFFIX,cursor.sh,🤖 AI 服务');

    assert.ok(api2Idx !== -1);
    assert.ok(cursorIdx !== -1);
    assert.ok(api2Idx < cursorIdx, 'api2.cursor.sh DIRECT bypass must precede cursor.sh 🤖 AI 服务');
  });

  await t.test('idempotency: multiple passes through assembleRules produce identical rules without duplication', () => {
    var declarativeRules = {
      rejectRules: ['DOMAIN-SUFFIX,ad.example.com,REJECT'],
      aiRules: ['DOMAIN-SUFFIX,openai.com,🤖 AI 服务'],
      directRules: ['DOMAIN-SUFFIX,cnki.net,DIRECT'],
    };
    var downstream = ['GEOIP,CN,DIRECT', 'MATCH,🔰 节点选择'];

    var pass1 = assembleRules(downstream, declarativeRules);
    var pass2 = assembleRules(pass1, declarativeRules);
    var pass3 = assembleRules(pass2, declarativeRules);

    assert.deepEqual(pass2, pass1, 'Pass 2 must be identical to pass 1');
    assert.deepEqual(pass3, pass1, 'Pass 3 must be identical to pass 1');
  });
});
