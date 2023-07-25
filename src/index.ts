import * as child from 'child_process';
import * as fs from 'fs';

const lookupDirectories: string[] = [
  '/usr/share/zoneinfo',
  '/usr/lib/zoneinfo',
  '/usr/local/etc/zoneinfo',
];

const sourceDirectories: string[] = [];

let defaultDirectory: string = '';

let npmZoneInfoChecked: boolean = false;

enum versions {
  v1 = '\0',
  v2 = '2',
  v3 = '3',
}

export type LocalInfo = {
  idx: number;
  tt_gmtoff: number;
  tt_isdst: boolean;
  tt_abbrind: number;
  abbrev?: string;
}

export type Leap = {
  time: number;
  add: number
}

export type ZoneInfoFile = {
  timezone: string;
  magic: string;
  version: versions;
  ttisgmtcnt: number;
  ttisstdcnt: number;
  leapcnt: number;
  timecnt: number;
  typecnt: number;
  charcnt: number;

  ttimes: number[];
  types: number[];
  tzinfo: LocalInfo[];
  abbrevs: string
  leaps: Leap[];
  ttisstd: boolean[];
  ttisgmt: boolean[]
  _end: number;
}

export function setDefaultDirectory(directory: string): void {
  defaultDirectory = directory;
  sourceDirectories.unshift(directory);
  return;
}

function getDefaultDirectory(): string {
  if (!defaultDirectory) {
    checkZoneInfoNpm();
    locateZoneInfoDirectory();
  }
  return defaultDirectory;
}

export function parse(timezone: string, directory?: string): ZoneInfoFile {
  if (!directory) {
    directory = getDefaultDirectory();
  }
  const path: string = `${directory}/${timezone}`;
  const buf: Buffer = fs.readFileSync(path);
  return {...decode(buf), timezone};
}

export function decode(buf: Buffer, position: number = 0): ZoneInfoFile {
  const octets: number = position == 0 ? 4 : 8;
  const info: ZoneInfoFile = {
    magic: buf.toString(undefined, 0, 4),
    // @ts-ignore
    version: buf.toString(undefined, 4, 5),
    ttisgmtcnt: int(buf, 20),
    ttisstdcnt: int(buf, 24),
    leapcnt: int(buf, 28),
    timecnt: int(buf, 32),
    typecnt: int(buf, 36),
    charcnt: int(buf, 40),
    _end: 0,
    abbrevs: '',
    leaps: [],
    timezone: '',
    ttimes: [],
    ttisgmt: [],
    ttisstd: [],
    types: [],
    tzinfo: [],
  };
  position += 44;
  if (info.magic !== 'TZif' || ![
    versions.v1, versions.v2, versions.v3,
  ].some((v) => v === info.version)) {
    throw Error('Invalid TZif file.');
  }

  for (let i = 0; i < info.timecnt; i++) {
    info.ttimes[i] = octets == 4 ? int(buf, position) : bigint(buf, position);
    position += octets;
  }
  for (let i = 0; i < info.timecnt; i++) {
    if (octets == 8) position++;
    info.types[i] = buf[position];
    if (octets == 4) position++;
  }

  for (let i = 0; i < info.typecnt; i++) {
    info.tzinfo[i] = {
      idx: i,
      tt_gmtoff: int(buf, position),
      tt_isdst: !!buf[position + 4],
      tt_abbrind: buf[position + 5],
    };
    position += 6;
  }

  info.abbrevs = buf.toString(undefined, position, position + info.charcnt);
  for (let i = 0; i < info.typecnt; i++) {
    info.tzinfo[i].abbrev = readStringZ(buf, position + info.tzinfo[i].tt_abbrind);
  }
  position += info.charcnt;

  for (let i = 0; i < info.leapcnt; i++) {
    info.leaps[i] = {
      time: octets == 4 ? int(buf, position) : bigint(buf, position),
      add: int(buf, position + octets), // total num seconds to add
    };
    position += (4 + octets);
  }
  for (let i = 0; i < info.ttisstdcnt; i++) {
    info.ttisstd[i] = !!buf[position++];
  }

  for (let i = 0; i < info.ttisgmtcnt; i++) {
    info.ttisgmt[i] = !!buf[position++];
  }
  info._end = position;
  if ([versions.v2, versions.v3].some((v) => v === info.version) && octets == 4) {
    return decode(buf, position);
  }
  return info;
}


function getLocalRoot() {
  return child.execSync('npm root').toString().trim();
}

function getGlobalRoot() {
  return child.execSync('npm root -g').toString().trim();
}

function checkZoneInfoNpm(): void {
  if (npmZoneInfoChecked) return;
  const suffix = '/zoneinfo-npm/zoneinfo';
  try {
    const local = getLocalRoot();
    const global = getGlobalRoot();
    lookupDirectories.unshift(`${global}${suffix}`, `${local}${suffix}`);
    npmZoneInfoChecked = true;
  } catch (err) {
    console.debug('An error occurred while trying to find npm root for zoneinfo package integration. System zoneinfo directories still work:', err);
    return;
  }
}

checkZoneInfoNpm();

export function locateZoneInfoDirectory(): void {
  for (let i = 0; i < lookupDirectories.length; i++) {
    try {
      const stat = fs.statSync(lookupDirectories[i]);
      if (stat.isDirectory()) {
        sourceDirectories.push(lookupDirectories[i]);
      }
    } catch (e) {
    }
  }
  if (!sourceDirectories.length) {
    console.warn(`Timezone information is missing in your system.
    **You may install zoneinfo-npm (https://www.npmjs.com/package/zoneinfo-npm) for timezone capacity**`);
    return;
  }
  defaultDirectory = sourceDirectories[0] || '';
}

locateZoneInfoDirectory();

console.log(sourceDirectories);

function readStringZ(buf: Buffer, offset: number): string {
  let end = offset;
  for (end; buf[end]; end++) {

  }
  return buf.toString(undefined, offset, end);
}

function int(buf: Buffer, offset: number): number {
  const val = (buf[offset++] * 0x1000000) + (buf[offset++] << 16) + (buf[offset++] << 8) + buf[offset++];
  return (val & 0x80000000) ? val - 0x100000000 : val;
}

function bigint(buf: Buffer, offset: number): number {
  if (buf[offset] & 0x80) {
    let [v1, v2] = [int(buf, offset), int(buf, offset + 4)];
    if (v2 < 0) v2 += 0x100000000;
    return v1 * 0x100000000 + v2;
  } else {
    let val = 0;
    for (let i = offset; i < offset + 8; i++) val = (val * 256) + buf[i];
    return val;
  }
}

export function readTimeZone(timezone: string, directory?: string): Buffer {
  if (!directory) {
    directory = getDefaultDirectory();
  }
  const filepath = directory + '/' + timezone;
  return fs.readFileSync(filepath);
}

export function findTimeZoneIn(info: ZoneInfoFile, date: number, acceptFirstKnown: boolean = true): LocalInfo {
  const seconds = Math.floor(date / 1000);

  const index = info.ttimes.reduce((acc, time, idx, times) => {
    if (time > times[acc] && time < seconds) {
      return idx;
    }
    return acc;
  }, -1);

  if (index >= 0) return info.tzinfo[info.types[index]];

  // if there are no time transitions but yes tzinfo, return the tzinfo (to always find GMT/UTC)
  if (!info.timecnt && info.typecnt) return info.tzinfo[0];

  // if timestamp is before first transition, optionally return the oldest known tzinfo
  if (acceptFirstKnown && info.typecnt) return info.tzinfo[info.types[0]];

  throw Error('There is no record of timezone information in the given date. Please consider accept the first known.');
}


let sp = parse('Asia/Jerusalem');
console.log(sp)
