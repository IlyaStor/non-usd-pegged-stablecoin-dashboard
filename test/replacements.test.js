import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildCatalogReport, sqlTokenRows, STATUS } from '../lib/token-catalog.js';
import { FX_FALLBACK } from '../lib/series.js';

const registry = JSON.parse(readFileSync('registry/verified-additions.json', 'utf8'));
const published = JSON.parse(readFileSync('data.json', 'utf8'));

function read(path) {
  return readFileSync(path, 'utf8');
}

function code(sql) {
  return sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
}

function seriesCode(label) {
  const text = String(label).trim();
  return text.includes(' - ') ? text.split(' - ').pop().trim() : text;
}

function evmRows(sql) {
  const rows = [];
  const re = /\(\s*(0x[0-9a-fA-F]{40})\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/g;
  let match;
  const body = code(sql);
  while ((match = re.exec(body))) {
    rows.push({
      address: match[1].toLowerCase(),
      label: match[2],
      decimals: Number(match[3]),
      price: match[4],
    });
  }
  return rows;
}

function solRows(sql) {
  const rows = [];
  const re = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*\)/g;
  let match;
  const body = code(sql);
  while ((match = re.exec(body))) {
    rows.push({ mint: match[1], label: match[2], price: match[3] });
  }
  return rows;
}

function stellarRows(sql) {
  const rows = [];
  const re = /\(\s*'([A-Z0-9]{56})'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/g;
  let match;
  const body = code(sql);
  while ((match = re.exec(body))) {
    rows.push({
      contract: match[1],
      label: match[2],
      decimals: Number(match[3]),
      price: match[4],
    });
  }
  return rows;
}

function unique(values) {
  assert.equal(new Set(values).size, values.length, `duplicate ${values}`);
}

const polygon1 = read('sql/replacements/6614895_polygon.sql');
const polygon2 = read('sql/replacements/6621899_polygon.sql');
const solana = read('sql/replacements/6689171_solana.sql');
const stellar = read('sql/replacements/6712377_stellar.sql');
const bsc = read('sql/replacements/8748306_bsc.sql');
const arc = read('sql/replacements/8924650_arc.sql');

const savedPolygon = [
  ['0x9de41aff9f55219d5bf4359f167d1d0c772a396d', 'Canadian dollar - CAD', 18],
  ['0xd2a530170d71a9cfe1651fb468e2b98f7ed7456b', 'Australian dollar - AUD', 6],
  ['0xd571edb2ef29df10fcd6200fd6d0ed2389983db3', 'Euro - EURQ', 6],
  ['0x888883b5f5d21fb10dfeb70e8f9722b9fb0e5e51', 'Euro - EUROP', 6],
  ['0xe0aea583266584dafbb3f9c3211d5588c73fea8d', 'Euro - EURe', 18],
  ['0x4fb71290ac171e1d144f7221d882becac7196eb5', 'Turkish Lira - TRYB', 6],
  ['0xb755506531786c8ac63b756bab1ac387bacb0c04', 'South African rand - ZARP', 18],
  ['0xab9ad9089f23e6779a8727900709427719f753e1', 'Nigerian naira - NGNC', 6],
  ['0x52828daa48c1a9a06f37500882b42daf0be04c3b', 'Nigerian naira - cNGC', 6],
];

describe('replacement SQL rosters', () => {
  it('adds EURAU, SEKAU, and CHFAU only to Polygon part 1 and keeps every saved row', () => {
    const part1 = evmRows(polygon1);
    const part2 = evmRows(polygon2);
    unique(part1.map(row => row.address));
    unique(part2.map(row => row.address));
    unique(part1.map(row => seriesCode(row.label)));
    unique(part2.map(row => seriesCode(row.label)));
    const part2Addresses = new Set(part2.map(row => row.address));
    for (const [address, label, decimals] of savedPolygon) {
      const hit = part1.find(row => row.address === address);
      assert.ok(hit, address);
      assert.equal(hit.label, label);
      assert.equal(hit.decimals, decimals);
      assert.equal(part2Addresses.has(address), false);
    }
    const added = [
      ['0x4933a85b5b5466fbaf179f72d3de273c287ec2c2', 'Euro - EURAU', 6],
      ['0x0297b579b0cb603b5ee814eb7322b960d3ae7a66', 'Swedish krona - SEKAU', 6],
      ['0xbd4dfc058eb95b8de5ceaf39966a1a70f5556f78', 'Swiss franc - CHFAU', 6],
      ['0x649a2da7b28e0d54c13d5eff95d3a660652742cc', 'Indonesian Rupiah - IDRX', 0],
    ];
    for (const [address, label, decimals] of added) {
      const hits = part1.filter(row => row.address === address);
      assert.equal(hits.length, 1, address);
      assert.equal(hits[0].label, label);
      assert.equal(hits[0].decimals, decimals);
      assert.equal(seriesCode(hits[0].label), seriesCode(label));
      assert.equal(part2Addresses.has(address), false, address);
    }
    assert.equal(part1.length, savedPolygon.length + added.length);
    assert.equal(part2.length, 11);
    assert.equal(part2.some(row => /EURAU|SEKAU|CHFAU|EURQ/.test(row.label)), false);
  });

  it('adds Solana EURAU and CHFAU without rescaling EURCV amount_display', () => {
    const rows = solRows(solana);
    unique(rows.map(row => row.mint));
    unique(rows.map(row => row.label));
    const eurcv = rows.filter(row => row.mint === 'DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52');
    assert.equal(eurcv.length, 1);
    assert.equal(eurcv[0].label, 'EURCV');
    assert.equal(solana.includes("('DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52', 'EURCV', 1.0428), -- decimals 2"), true);
    const byLabel = Object.fromEntries(rows.map(row => [row.label, row]));
    assert.equal(byLabel.EURAU.mint, '9pCWprxbZMW2rYSMhPTeoyLMV2sN2WJqshdT7DQVt6hS');
    assert.equal(byLabel.CHFAU.mint, '3GJfXJvPcjuAu6VQZmcs9pAXQau8nz3z88CCpBztgQSv');
    assert.equal(byLabel.EURAU.label.includes(' - '), false);
    assert.equal(code(solana).includes('amount_display'), true);
    assert.equal(/amount_display\s*\//.test(code(solana)), false);
    assert.equal(/POWER\s*\(\s*10/.test(code(solana)), false);
    assert.equal(rows.some(row => row.label === 'SEKAU'), false);
    assert.equal(byLabel.IDRX.mint, 'idrxZcP8xiKkYk6XGD4uz1dxEYCWSgKDHqgjsBbwDur');
    assert.equal(byLabel.IDRX.price, '0.000061');
    assert.equal(byLabel.ZARsc.mint, '5ekaHEqpRUXH4RoZVRMErdJE74bibWAzihMtPcjKyceQ');
    assert.equal(byLabel.ZARsc.price, '0.0604847');
    assert.equal(code(solana).includes('idrxTdNftk6tYedPv2M7tCFHBVCpk5rkiNRd8yUArhr'), false);
    for (const mint of [
      'FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD',
      'A94X2fRy3wydNShU4dRaDyap2UuoeWJGWyATtyp61WZf',
      'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
      'C4Kkr9NZU3VbyedcgutU6LKmi6MKz81sx6gRmk5pX519',
      'AhhdRu5YZdjVkKR3wbnUDaymVQL2ucjMQ63sZ3LFHsch',
      '2VhjJ9WxaGC3EZFwJG9BDUs9KxKCAjQY4vgd1qxgYWVg',
    ]) {
      assert.equal(rows.some(row => row.mint === mint), true, mint);
    }
  });

  it('scales Stellar per token and does not price BRMB or classic issuers', () => {
    const rows = stellarRows(stellar);
    unique(rows.map(row => row.contract));
    unique(rows.map(row => seriesCode(row.label)));
    const byContract = Object.fromEntries(rows.map(row => [row.contract, row]));
    const saved = {
      CACXKRVCW7I6CWX6RS6ANFDKVCOUI2PB6LTDUROL3J3FMJCRZ4ZLQRF6: ['Australian Digital Dollar - AUDD', 7, '0.6298'],
      CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV: ['Euro - EURC (Circle)', 7, '1.0428'],
      CA67EQNWGPGXHVT6E4HQ65WEV54KFDB6HJDHVCJM33VKZ7XKR5MN3KPJ: ['Japanese Yen - GYEN', 7, '0.006609'],
      CCD6H4LBTHAPY3NGEE6TLLRUSPJGX4K5XI2J6E4MUNDB5TNXEKC23H5B: ['Argentinian Peso - ARS', 7, '0.00072'],
      CBYFV4W2LTMXYZ3XWFX5BK2BY255DU2DSXNAE4FJ5A5VYUWGIBJDOIGG: ['Nigerian Naira - NGNC', 7, '0.00074'],
      CDJJQLCW6GFVUXJOXXONVC6KHPTY4RFMDKFBAP6SHWVKICXPRS4RSIKY: ['Euro - EURS', 7, '1.0428'],
      CDIA2WBXIDLXYNL4IU55K77BUZHTC5E65ZGCOXEAEJDIW4XLHZHCSC7X: ['Brazilian Real - BRLT', 7, '0.19'],
      CCFS6UDFSR5OJIN45RQPUCZ5JTTU5TQOTIS6XKYKNWKC4TVR752BOWOF: ['Peruvian Peso - PEN', 7, '0.27'],
    };
    for (const [contract, [label, decimals, price]] of Object.entries(saved)) {
      assert.equal(byContract[contract].label, label);
      assert.equal(byContract[contract].decimals, decimals);
      assert.equal(byContract[contract].price, price);
    }
    assert.equal(byContract.CAA56M3OKR2IHHJB4ZAUPAJDYOGFXSVYN6NFJGN7PJN4NUMRKSDFABYI.label, 'Euro - EURQ');
    assert.equal(byContract.CAA56M3OKR2IHHJB4ZAUPAJDYOGFXSVYN6NFJGN7PJN4NUMRKSDFABYI.decimals, 7);
    assert.equal(byContract.CANKBYNNAYKEZXLB655F2UPNTAZFK5HILZUXL7ZTFR3NF6LKDSVY7KFH.label, 'Euro - EURCV');
    assert.equal(byContract.CANKBYNNAYKEZXLB655F2UPNTAZFK5HILZUXL7ZTFR3NF6LKDSVY7KFH.decimals, 7);
    assert.equal(byContract.CB44W727WSLHPXJ47A6DHF5D34RKWSOZAMEDXO3CF5TEEEQ2ZX4V3VRI.label, 'Euro - EURAU');
    assert.equal(byContract.CB44W727WSLHPXJ47A6DHF5D34RKWSOZAMEDXO3CF5TEEEQ2ZX4V3VRI.decimals, 6);
    assert.equal(rows.length, 11);
    assert.equal(code(stellar).includes('POWER(10, t.decimals)'), true);
    assert.equal(code(stellar).includes('/ 10000000'), false);
    assert.equal(code(stellar).includes('CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR'), false);
    assert.equal(stellar.includes('USD_BLOCKED BRMB SAC CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR'), true);
    assert.equal(code(stellar).includes('GCA6KZBWPBOEF6M2MZBTXRMKLMWRZOUCL2JFSIDT3WTDBOFIVDC4C4CE'), false);
    assert.equal(code(stellar).includes('GCEYGIVOLAVBF2TG2RUSGTUJCIN75KEX3NGLMY4VPL4GFE5L355AXW3G'), false);
    assert.equal(code(stellar).includes('GBVXEEYTHW4PUHVOOSEUPS4TTKVRU7XDZJIKAIZRG2H2XU7YWDEFKNTP'), false);
    assert.equal(stellar.includes('Classic Stellar payments'), true);
    assert.equal(rows.some(row => row.label.includes('BRMB')), false);
    assert.equal(rows.some(row => row.price === '0' || row.price === '1'), false);
  });

  it('adds both EURI and EURAU on BSC and keeps the KGST row', () => {
    const rows = evmRows(bsc);
    unique(rows.map(row => row.address));
    unique(rows.map(row => seriesCode(row.label)));
    const byLabel = Object.fromEntries(rows.map(row => [row.label, row]));
    assert.equal(byLabel.KGST.address, '0x94be0bba8e1e303fe998c9360b57b826f1a4f828');
    assert.equal(byLabel.KGST.decimals, 18);
    assert.equal(byLabel.KGST.price, '0.0114');
    assert.equal(byLabel.EURI.address, '0x9d1a7a3191102e9f900faa10540837ba84dcbae7');
    assert.equal(byLabel.EURI.decimals, 18);
    assert.equal(byLabel.EURI.price, String(FX_FALLBACK.EURI));
    assert.equal(byLabel.EURAU.address, '0x4933a85b5b5466fbaf179f72d3de273c287ec2c2');
    assert.equal(byLabel.EURAU.decimals, 6);
    assert.equal(byLabel.EURAU.price, String(FX_FALLBACK.EURAU));
    assert.equal(rows.some(row => row.label.includes('EURITE')), false);
    assert.equal(byLabel.IDRX.address, '0x649a2da7b28e0d54c13d5eff95d3a660652742cc');
    assert.equal(byLabel.IDRX.decimals, 0);
    assert.equal(byLabel.IDRX.price, '0.000061');
    assert.equal(rows.length, 4);
  });

  it('does not duplicate Arc contracts that the saved query already lists', () => {
    const savedRows = sqlTokenRows(read('sql/arc_nonusd_transfers_clean.sql'));
    const replacementRows = sqlTokenRows(arc);
    assert.deepEqual(
      replacementRows.map(row => [row.address.toLowerCase(), row.decimals]),
      savedRows.map(row => [row.address.toLowerCase(), row.decimals]),
    );
    for (const address of [
      '0x4933a85b5b5466fbaf179f72d3de273c287ec2c2',
      '0xf8524b5ab17d5eca2f78abe8377ceffd323b1dc1',
      '0xc6df1b92a6ae61a27059c41e541a91ce8dcb1605',
    ]) {
      assert.equal(replacementRows.filter(row => row.address.toLowerCase() === address).length, 1);
    }
    assert.equal(arc.includes('SQL presence does not prove a transfer series'), true);
  });

  it('does not mark replacement-sql tokens live from registry metadata', () => {
    const report = buildCatalogReport({
      registry,
      data: published.data,
      executions: published.executions,
      arcSql: read('sql/arc_nonusd_transfers.sql'),
    });
    const live = report.rows.filter(row => row.status === STATUS.LIVE).map(row => `${row.analyticsSymbol}|${row.dashboardNetwork}`);
    assert.equal(live.includes('EURQ|polygon'), true);
    assert.equal(live.includes('EURCV|solana'), true);
    assert.equal(live.some(key => key.startsWith('IDRX|')), false);
    const polygonEurau = report.rows.find(item => item.analyticsSymbol === 'EURAU' && item.dashboardNetwork === 'polygon');
    assert.equal(polygonEurau.status, STATUS.PENDING_DUNE);
    const nowPublished = ['SEKAU|polygon', 'CHFAU|polygon', 'EURAU|solana', 'CHFAU|solana', 'EURI|bsc', 'EURAU|bsc', 'EURQ|stellar', 'EURCV|stellar', 'EURAU|stellar'];
    for (const key of nowPublished) {
      const row = report.rows.find(item => `${item.analyticsSymbol}|${item.dashboardNetwork}` === key);
      assert.equal(row.status, STATUS.LIVE, key);
    }
    const brmb = report.rows.find(row => row.token === 'BRMB' && row.chainSlug === 'stellar');
    assert.equal(brmb.status, STATUS.BLOCKED_NO_FX);
    assert.equal(brmb.stellar.sac_contract, 'CBD67SY7LMNGXVELAAAUX7LHADZFJ4CK6BHYW36XBHCDNHQP5QO3AKXR');
    const fetchSource = read('fetch-dune-data.js');
    assert.equal(fetchSource.includes('sql/replacements'), false);
  });
});
