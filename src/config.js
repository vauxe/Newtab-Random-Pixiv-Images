export const Order = Object.freeze({
  date_d: 'date_d',
  date: 'date',
  popular_d: 'popular_d',
  popular_male_d: 'popular_male_d',
  popular_female_d: 'popular_female_d'
});

export const Mode = Object.freeze({
  all: 'all',
  r18: 'r18',
  safe: 'safe'
});

export const SMode = Object.freeze({
  s_tag: 's_tag',
  s_tag_full: 's_tag_full',
  s_tc: 's_tc'
})

export const ImageType = Object.freeze({
  all: 'all',
  illust_and_ugoira: 'illust_and_ugoira',
  illust: 'illust',
  manga: 'manga',
  ugoira: 'ugoira'
});

export const TimeOption = Object.freeze({
  unlimited: 'unlimited',
  specific: 'specific'
});

export const defaultConfig = {
  order: Order.date_d, // sort order
  mode: Mode.safe, // search mode
  timeOption: TimeOption.unlimited,
  scd: null, // start date
  ecd: null, // end date
  blt: null, // minimum likes number
  bgt: null, // maximum likes number
  s_mode: SMode.s_tag,
  type: ImageType.illust,
  // sl perhaps means pixiv safe level, 2 is safe, 6 is not safe
  min_sl: null,
  max_sl: null,
  aiType: null, // pixiv ai type, 1 not ai, 2 is ai
  orKeywords: "7500users入り 10000users入り 30000users入り 50000users入り",
  minusKeywords: "虚偽users入りタグ 描き方 講座 作画資料 創作 素材 漫画",
  andKeywords: "",
}

export function getKeywords(andKeywords, orKeywords, minusKeywords) {
  let andKeywordsList = andKeywords.trim().split(/\s+/).filter(Boolean);
  let orKeywordsList = orKeywords.trim().split(/\s+/).filter(Boolean);
  let minusKeywordsList = minusKeywords.trim().split(/\s+/).filter(Boolean);
  let aWord = andKeywordsList.length ? andKeywordsList.join(' ') : '';
  let pWord = orKeywordsList.length ? '(' + orKeywordsList.join(" OR ") + ')' : '';
  let nWord = minusKeywordsList.length ? "-" + minusKeywordsList.join(" -") : '';
  let allWords = []
  if (aWord) {
    allWords.push(aWord);
  }
  if (nWord) {
    allWords.push(nWord);
  }
  if (pWord) {
    allWords.push(pWord);
  }
  let word = allWords.join(' ');
  return word;
}
