/**
 * ISO code tables the runtime does not provide. Generated from Debian's
 * iso-codes data (ISO 3166-1 and ISO 639-2), plus Kosovo as Google reports
 * it (`xkk` / `XK`). Pure.
 */

// alpha-3 (lower case, as Search Console reports countries) + alpha-2.
const ALPHA3 = `
abwAW afgAF agoAO aiaAI alaAX albAL andAD areAE argAR armAM asmAS ataAQ atfTF atgAG ausAU autAT
azeAZ bdiBI belBE benBJ besBQ bfaBF bgdBD bgrBG bhrBH bhsBS bihBA blmBL blrBY blzBZ bmuBM bolBO
braBR brbBB brnBN btnBT bvtBV bwaBW cafCF canCA cckCC cheCH chlCL chnCN civCI cmrCM codCD cogCG
cokCK colCO comKM cpvCV criCR cubCU cuwCW cxrCX cymKY cypCY czeCZ deuDE djiDJ dmaDM dnkDK domDO
dzaDZ ecuEC egyEG eriER eshEH espES estEE ethET finFI fjiFJ flkFK fraFR froFO fsmFM gabGA gbrGB
geoGE ggyGG ghaGH gibGI ginGN glpGP gmbGM gnbGW gnqGQ grcGR grdGD grlGL gtmGT gufGF gumGU guyGY
hkgHK hmdHM hndHN hrvHR htiHT hunHU idnID imnIM indIN iotIO irlIE irnIR irqIQ islIS isrIL itaIT
jamJM jeyJE jorJO jpnJP kazKZ kenKE kgzKG khmKH kirKI knaKN korKR kwtKW laoLA lbnLB lbrLR lbyLY
lcaLC lieLI lkaLK lsoLS ltuLT luxLU lvaLV macMO mafMF marMA mcoMC mdaMD mdgMG mdvMV mexMX mhlMH
mkdMK mliML mltMT mmrMM mneME mngMN mnpMP mozMZ mrtMR msrMS mtqMQ musMU mwiMW mysMY mytYT namNA
nclNC nerNE nfkNF ngaNG nicNI niuNU nldNL norNO nplNP nruNR nzlNZ omnOM pakPK panPA pcnPN perPE
phlPH plwPW pngPG polPL priPR prkKP prtPT pryPY psePS pyfPF qatQA reuRE rouRO rusRU rwaRW sauSA
sdnSD senSN sgpSG sgsGS shnSH sjmSJ slbSB sleSL slvSV smrSM somSO spmPM srbRS ssdSS stpST surSR
svkSK svnSI sweSE swzSZ sxmSX sycSC syrSY tcaTC tcdTD tgoTG thaTH tjkTJ tklTK tkmTM tlsTL tonTO
ttoTT tunTN turTR tuvTV twnTW tzaTZ ugaUG ukrUA umiUM uryUY usaUS uzbUZ vatVA vctVC venVE vgbVG
virVI vnmVN vutVU wlfWF wsmWS xkkXK yemYE zafZA zmbZM zweZW
`;

// ISO 639-1 two-letter language codes.
const LANGUAGES = `
aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de
dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id
ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu
lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu
rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr
ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu
`;

let alpha3: Map<string, string> | null = null;
let languages: Set<string> | null = null;

/** "ind" → "IN". Null when the code is not an ISO 3166-1 alpha-3 code. */
export function alpha2FromAlpha3(code: string): string | null {
  if (!alpha3) {
    alpha3 = new Map();
    for (const entry of ALPHA3.split(/\s+/)) if (entry) alpha3.set(entry.slice(0, 3), entry.slice(3));
  }
  return alpha3.get(code.toLowerCase()) ?? null;
}

/** Whether a two-letter code is an ISO 639-1 language. */
export function isLanguageCode(code: string): boolean {
  if (!languages) languages = new Set(LANGUAGES.split(/\s+/).filter(Boolean));
  return languages.has(code.toLowerCase());
}
