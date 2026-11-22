// Heroes with a history between them (from history and legend). Two of them on opposite sides of a match are a
// rivalry: they are put up against each other as the day's duel (game/duel.ts), with words of their own.

/** [hero, hero, what is said when they meet] */
export const RIVALS: readonly (readonly [number, number, string])[] = [
  [5019, 3051, '兄と弟、因縁の対決！'], // 源義経・源頼朝
  [5019, 2038, '源氏と平家、因縁の対決！'], // 源義経・平清盛
  [5028, 2038, '源氏と平家、因縁の対決！'], // 那須与一・平清盛
  [2026, 2020, '天下をかけた因縁の対決！'], // 豊臣秀吉・明智光秀
  [2026, 3044, '天下をあらそった因縁の対決！'], // 豊臣秀吉・徳川家康
  [2018, 3044, '大坂の陣の因縁！'], // 茶々・徳川家康
  [3038, 3044, '真田と徳川、因縁の対決！'], // 猿飛佐助・徳川家康
  [4055, 4025, '戦国の因縁の対決！'], // 本多忠勝・武田信玄
  [3010, 2043, '忍びどうし、因縁の対決！'], // 服部半蔵・霧隠才蔵
  [4039, 4005, '江戸の命運をかけた因縁！'], // 西郷隆盛・勝海舟
  [4039, 4027, '幕末の因縁の対決！'], // 西郷隆盛・土方歳三
  [4039, 4035, '幕末の因縁の対決！'], // 西郷隆盛・近藤勇
  [4001, 3048, '一騎打ちの再戦！'], // 張飛・馬超
  [4001, 4037, 'かつての義兄弟！'], // 張飛・関羽
  [4001, 5009, 'かつての義兄弟！'], // 張飛・劉備
  [4016, 4037, '虎牢関の因縁！'], // 呂布・関羽
  [4016, 3049, '裏切りの因縁！'], // 呂布・董卓
  [4016, 5003, '下邳の因縁！'], // 呂布・曹操
  [4016, 5009, '乱世の因縁の対決！'], // 呂布・劉備
  [3020, 3049, '連環の計の因縁！'], // 貂蝉・董卓
  [5015, 4048, '赤壁の知恵くらべ！'], // 諸葛亮・周瑜
  [5015, 5003, '天下三分の因縁！'], // 諸葛亮・曹操
  [3041, 2023, '芸術の好敵手！'], // ラファエロ・ミケランジェロ
  [4011, 2031, '鉄と資本の因縁！'], // マルクス・ビスマルク
];

/** What is said when these two meet as rivals (null: no history). */
export function rivalLine(a: number, b: number): string | null {
  for (const [x, y, line] of RIVALS) if ((x === a && y === b) || (x === b && y === a)) return line;
  return null;
}
