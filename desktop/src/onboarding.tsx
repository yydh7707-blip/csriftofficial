import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LEGAL_VERSION, type AppLanguage, type LegalConsent, type OnboardingProgress } from './onboarding-state'

type LegalSection = { title: string; paragraphs: string[] }
type LegalDocument = { title: string; introduction: string; sections: LegalSection[] }

const documents: Record<AppLanguage, { privacy: LegalDocument; terms: LegalDocument }> = {
  en: {
    privacy: {
      title: 'Privacy Policy',
      introduction: 'Effective date: November 16, 2026. This notice describes the current Windows desktop app and its optional Steam sign-in. CSRIFT does not operate advertising or analytics trackers.',
      sections: [
        { title: '1. Who operates CSRIFT and how to contact us', paragraphs: ['CSRIFT is independently operated by 연서준 in the Republic of Korea and is not affiliated with or endorsed by Valve, Steam, Riot Games, Nexon, or the publishers of supported games. Privacy inquiries and requests may be sent to yydh7707@gmail.com. The operator’s postal address has not been provided and must be confirmed before public release.'] },
        { title: '2. Information processed and purposes', paragraphs: ['On this PC, CSRIFT stores the chosen language, selected game and executable paths in local WebView storage; recent app-activity summaries and ping history (including the target address and measured replies) are also kept locally. Onboarding completion and the policy/terms versions, language and timestamp you accepted are stored locally as consent evidence. Other app preferences and supported configuration backups are kept in CSRIFT’s private Windows application-data directory. These records are used to remember your choices and provide local history; they are not sent to CSRIFT servers.', 'When you use local features, CSRIFT reads only the information needed for that feature, such as Windows CPU, memory and graphics-device information, running-process names, Steam library manifests, supported game paths, and configuration-file names. A manually requested ping sends ICMP echo requests to the IP address you enter. Local scan results, process information, settings and backups are not uploaded by these features.'] },
        { title: '3. Steam sign-in and service providers', paragraphs: ['If you choose Steam sign-in, your browser is redirected to Steam Community’s official OpenID page. CSRIFT does not ask for or receive your Steam password. The CSRIFT Cloudflare Worker verifies the OpenID response and processes your 17-digit SteamID. The current API endpoint is csrift-api.yydh7707.workers.dev; Cloudflare Workers and D1 host the authentication service and its database.', 'The server stores the SteamID and a generic Steam account profile reference, authentication-flow and replay-prevention records, and a hash of the issued session token. Sessions expire no later than 30 days and are revoked when logout succeeds. Cloudflare’s request metadata includes the connecting IP; the Worker hashes it for rate limiting and does not intentionally log Steam credentials, session tokens, or OpenID assertion values.', 'Steam ownership and local installation are separate. OpenID sign-in alone does not provide an owned-games list, nickname or avatar. Owned-game lookup is a separate optional Steam Web API feature; it works only when the operator has configured a Steam API key and Steam makes the library available. If available, game names, App IDs, icons and playtime may be cached in D1 and refreshed after 15 minutes; the current service has no automatic deletion schedule for that cache. If unavailable, CSRIFT must not represent the library as loaded. Steam and Cloudflare process data under their own terms and privacy notices.'] },
        { title: '4. Collection method and disclosures', paragraphs: ['You provide app choices and executable paths directly. Windows information is read locally when you open or run the relevant CSRIFT feature. Steam account data is received from the verified Steam OpenID response only after you start sign-in. CSRIFT does not sell personal information or disclose local scan results to game publishers. Data is sent to Steam and Cloudflare only as required for the sign-in or optional server feature you request.'] },
        { title: '5. Retention and deletion', paragraphs: ['WebView choices, activity and ping history, and consent records remain in this Windows user profile until you clear CSRIFT WebView/app data or remove the app data. App preferences and local backups remain in the private CSRIFT application-data directory until removed there or through CSRIFT’s supported backup controls. Clearing local records also removes the local evidence of consent.', 'A server-side Steam session is valid for up to 30 days and can be revoked by logout. Steam account identifiers and operational authentication records are held in Cloudflare D1 for authentication, replay prevention and abuse prevention. The current service does not provide a self-service account-data deletion endpoint or a published automatic purge schedule for all expired operational records or an old owned-game cache. Send access or deletion requests to yydh7707@gmail.com; the operator must handle server-side requests manually.'] },
        { title: '6. Your choices and rights', paragraphs: ['Steam sign-in is optional; local game detection and Windows monitoring can be used without connecting Steam. You may disconnect a CSRIFT session at any time. You can change language and review these documents in Settings. Subject to applicable law, including South Korea’s Personal Information Protection Act, you may request access, correction, deletion or suspension of processing of personal information and submit a privacy inquiry to yydh7707@gmail.com. Local data can be removed by clearing CSRIFT app data; doing so cannot delete a server-side record.'] },
        { title: '7. Cookies, device data and automated collection', paragraphs: ['The Windows desktop app does not set advertising cookies and does not include analytics or ad SDKs. The app’s WebView storage is used for local preferences, onboarding and consent records. The app reads device and system information only for the local feature being displayed. The Worker receives standard network request metadata, including an IP address, and uses a one-way hash for rate limiting. No cross-app tracking profile is created.'] },
        { title: '8. Security', paragraphs: ['Steam authentication is verified by the server using OpenID 2.0; the app never handles Steam passwords. Session tokens are stored as hashes in the server database and are held in app memory on the desktop client. Local backups are stored in the CSRIFT application-data directory. No security measure is absolute, and internet transmission to Steam or Cloudflare carries the risks inherent in those services.'] },
        { title: '9. Children, changes and inquiries', paragraphs: ['CSRIFT is a PC game-management utility, not a service designed to collect children’s information. The operator will publish any material policy change in the app or on the official site and update the effective date. For privacy questions, rights requests and complaints, contact the operator, 연서준, at yydh7707@gmail.com. The operator’s postal address remains unprovided and should be confirmed before public release.'] },
      ],
    },
    terms: {
      title: 'Terms of Service',
      introduction: 'Effective date: November 16, 2026. Please read these terms before using CSRIFT.',
      sections: [
        { title: '1. Purpose and service', paragraphs: ['These terms govern use of CSRIFT, a Windows utility for viewing local PC information, finding supported game installations, managing supported local configuration backups, and using optional Steam account authentication. CSRIFT does not provide, sell, host or operate the games themselves.'] },
        { title: '2. Operator and contact', paragraphs: ['CSRIFT is independently operated by 연서준 in the Republic of Korea and is not an official product, partner or endorsement of Valve/Steam, Riot Games, Nexon, or any game publisher. Privacy inquiries may be sent to yydh7707@gmail.com. The operator’s postal address has not been provided and should be confirmed before public release.'] },
        { title: '3. Acceptance and changes', paragraphs: ['The terms take effect when you affirmatively check the Terms acceptance box and continue onboarding. The app records the document version, acceptance time and selected language locally on this PC. Updated terms will be shown for review and acceptance before features requiring that acceptance are used.'] },
        { title: '4. Features and availability', paragraphs: ['Features depend on your Windows version, installed games, permissions and the game’s own software. Detection is not a guarantee of ownership, compatibility or successful launch. Steam sign-in confirms an account identifier only; owned-game lookup is separate, may require a Steam Web API key and may be unavailable for private libraries. CSRIFT may modify, suspend or discontinue online services or individual features for maintenance, security, legal or operational reasons. Local features may continue where possible.'] },
        { title: '5. Your responsibilities and prohibited use', paragraphs: ['Use CSRIFT only on a device and game installation you are authorized to access. Review each proposed system change and keep independent backups of important files. Do not use CSRIFT to violate law, infringe another person’s rights, disrupt a service, bypass access controls or anti-cheat protections, manipulate game memory, inject code, or interfere with a game’s security systems. CSRIFT is not designed to provide those functions.'] },
        { title: '6. System changes and account security', paragraphs: ['Some clearly identified tools may offer a system or configuration change. Read the described effect and confirmation prompt before applying it. Where a backup or restore is offered, inspect its scope; it is not a substitute for a full system backup. Keep your Windows account and Steam account secure. Steam credentials must be entered only on Steam’s official sign-in page.'] },
        { title: '7. Intellectual property', paragraphs: ['CSRIFT software, branding and original interface materials are owned by their respective rights holders. Game titles, logos and other publisher materials remain the property of their respective owners and are used only to identify supported games. You receive a limited, revocable right to use CSRIFT for its intended personal PC-management purposes; no game license or publisher endorsement is granted.'] },
        { title: '8. Suspension and termination', paragraphs: ['The operator may limit or suspend access where reasonably necessary to address abuse, security risks, legal requirements or material violations of these terms. You may stop using CSRIFT and revoke the CSRIFT Steam session at any time. Uninstalling the app does not by itself delete server-side records; send a data request to yydh7707@gmail.com.'] },
        { title: '9. Disclaimers, liability and damages', paragraphs: ['CSRIFT is provided on an “as available” basis. System readings, game detection and recommendations can be incomplete or unavailable, and no FPS improvement, latency reduction, compatibility or uninterrupted service is promised. To the extent permitted by applicable law, the operator excludes implied warranties and is not responsible for indirect or consequential loss arising from use of the app. Nothing in these terms excludes liability that applicable law does not allow to be excluded, including liability for intentional misconduct or gross negligence where such exclusion is prohibited. You remain responsible for reviewing changes and maintaining suitable backups.'] },
        { title: '10. Governing law, disputes and support', paragraphs: ['These terms are governed by the laws of the Republic of Korea, subject to mandatory consumer protections that apply to you. Disputes are subject to courts having jurisdiction under applicable Korean law. For privacy inquiries, contact 연서준 at yydh7707@gmail.com. The operator’s postal address remains unprovided and should be confirmed before public release.'] },
      ],
    },
  },
  ko: {
    privacy: {
      title: '개인정보 처리방침',
      introduction: '시행일: 2026년 11월 16일. 본 문서는 현재 Windows 데스크톱 앱과 선택형 Steam 로그인의 실제 처리 흐름을 설명합니다. CSRIFT는 광고·분석 추적 도구를 운영하지 않습니다.',
      sections: [
        { title: '1. 운영자 및 문의처', paragraphs: ['CSRIFT는 대한민국에서 연서준이 독립적으로 운영하며 Valve, Steam, Riot Games, Nexon 또는 지원 게임의 퍼블리셔와 제휴·승인 관계가 아닙니다. 개인정보 관련 문의와 요청은 yydh7707@gmail.com으로 보낼 수 있습니다. 운영자의 우편 주소는 제공되지 않았으므로 공개 출시 전에 확인해야 합니다.'] },
        { title: '2. 처리하는 정보와 목적', paragraphs: ['이 PC에서 CSRIFT는 선택한 언어·게임과 실행 파일 경로를 로컬 WebView 저장소에 보관합니다. 최근 앱 활동 요약과 핑 기록(대상 주소 및 측정 응답 포함)도 로컬에 저장됩니다. 온보딩 완료 여부와 동의한 문서 버전·언어·시각은 동의 증빙으로 로컬에 기록됩니다. 그 밖의 앱 환경설정과 지원 설정 백업은 CSRIFT의 비공개 Windows 앱 데이터 폴더에 보관됩니다. 이 정보는 선택을 기억하고 로컬 기록을 제공하기 위한 것으로 CSRIFT 서버에 전송되지 않습니다.', '로컬 기능을 사용할 때 해당 기능에 필요한 Windows CPU·메모리·그래픽 장치 정보, 실행 중인 프로세스 이름, Steam 라이브러리 매니페스트, 지원 게임 경로 및 설정 파일 이름을 읽을 수 있습니다. 사용자가 직접 요청한 핑 테스트는 입력한 IP 주소로 ICMP 요청을 보냅니다. 이러한 기능은 로컬 검사 결과, 프로세스 정보, 설정과 백업을 업로드하지 않습니다.'] },
        { title: '3. Steam 로그인 및 처리 수탁자', paragraphs: ['Steam 로그인을 선택하면 기본 브라우저가 Steam Community의 공식 OpenID 페이지로 이동합니다. CSRIFT는 Steam 비밀번호를 요청하거나 받지 않습니다. CSRIFT Cloudflare Worker가 OpenID 응답을 검증하고 17자리 SteamID를 처리합니다. 현재 API 주소는 csrift-api.yydh7707.workers.dev이며, 인증 서비스와 데이터베이스는 Cloudflare Workers 및 D1에서 운영됩니다.', '서버에는 SteamID와 일반적인 Steam 계정 프로필 참조, 인증 흐름 및 재사용 방지 기록, 발급된 세션 토큰의 해시가 저장됩니다. 세션은 최대 30일 후 만료되며 로그아웃이 성공하면 폐기됩니다. Cloudflare 요청 메타데이터에는 접속 IP가 포함됩니다. Worker는 요청 제한을 위해 IP를 해시하며 Steam 비밀번호, 세션 토큰 또는 OpenID 인증 응답 값을 의도적으로 로그에 기록하지 않습니다.', 'Steam 계정 보유 게임과 이 PC에 설치된 게임은 서로 다른 정보입니다. OpenID 로그인만으로 보유 게임 목록, 닉네임 또는 프로필 사진을 얻지 않습니다. 보유 게임 조회는 별도의 선택적 Steam Web API 기능이며 운영자가 Steam API 키를 설정하고 Steam 측에서 라이브러리를 제공하는 경우에만 가능합니다. 제공되는 경우 게임명, App ID, 아이콘 및 플레이 시간은 D1에 캐시되고 15분 후 갱신될 수 있습니다. 현재 해당 캐시에 대한 자동 삭제 일정은 없습니다. 조회할 수 없으면 목록을 불러온 것처럼 표시하지 않습니다. Steam과 Cloudflare는 각자의 약관과 개인정보 처리방침에 따라 정보를 처리합니다.'] },
        { title: '4. 수집 방법 및 제3자 제공', paragraphs: ['앱 선택과 실행 파일 경로는 사용자가 직접 입력합니다. Windows 정보는 관련 CSRIFT 기능을 열거나 실행할 때 이 PC에서 읽습니다. Steam 계정 정보는 사용자가 로그인을 시작하고 검증된 Steam OpenID 응답을 받은 경우에만 처리합니다. CSRIFT는 개인정보를 판매하거나 로컬 검사 결과를 게임 퍼블리셔에 제공하지 않습니다. 요청한 로그인 또는 선택적 서버 기능에 필요한 정보만 Steam 및 Cloudflare로 전송됩니다.'] },
        { title: '5. 보유 기간 및 파기', paragraphs: ['WebView 선택 정보, 활동·핑 기록과 동의 기록은 CSRIFT WebView/앱 데이터를 지우거나 앱 데이터를 제거할 때까지 이 Windows 사용자 프로필에 남습니다. 앱 환경설정과 로컬 백업은 CSRIFT의 비공개 앱 데이터 폴더에 보관되며 해당 위치 또는 CSRIFT의 백업 관리 기능에서 삭제할 때까지 유지됩니다. 로컬 기록을 지우면 이 기기의 동의 증빙도 삭제됩니다.', '서버 Steam 세션은 최대 30일간 유효하며 로그아웃으로 폐기할 수 있습니다. Steam 계정 식별 정보와 인증 운영 기록은 인증·재사용 방지·남용 방지를 위해 Cloudflare D1에 보관됩니다. 현재 서비스에는 사용자가 직접 계정 데이터를 삭제하는 API나 만료된 운영 기록 및 오래된 보유 게임 캐시에 대한 공개된 자동 파기 일정이 없습니다. 서버 데이터 열람·삭제 요청은 yydh7707@gmail.com으로 보내야 하며 운영자가 수동으로 처리해야 합니다.'] },
        { title: '6. 이용자 권리와 선택', paragraphs: ['Steam 연결은 선택 사항이며 연결하지 않아도 로컬 게임 탐지와 Windows 모니터링을 이용할 수 있습니다. CSRIFT 세션은 언제든지 해제할 수 있습니다. 설정에서 언어를 바꾸고 문서를 다시 확인할 수 있습니다. 대한민국 개인정보 보호법 등 관련 법령에 따라 개인정보 열람·정정·삭제·처리정지를 요청하거나 개인정보 관련 문의를 yydh7707@gmail.com으로 보낼 수 있습니다. 로컬 데이터는 CSRIFT 앱 데이터를 지워 제거할 수 있지만 이 작업은 서버 기록을 삭제하지 않습니다.'] },
        { title: '7. 쿠키·기기 정보·자동 수집', paragraphs: ['Windows 데스크톱 앱은 광고 쿠키를 설정하지 않으며 분석 또는 광고 SDK를 포함하지 않습니다. 앱의 WebView 저장소는 로컬 설정, 온보딩 및 동의 기록에 사용됩니다. 기기·시스템 정보는 표시 중인 로컬 기능에 필요한 범위에서만 읽습니다. Worker는 IP 주소 등 일반 네트워크 요청 정보를 받으며 요청 제한을 위해 단방향 해시를 사용합니다. 앱 간 추적 프로필은 만들지 않습니다.'] },
        { title: '8. 안전성 확보', paragraphs: ['Steam 인증은 서버가 OpenID 2.0으로 검증하며 앱은 Steam 비밀번호를 취급하지 않습니다. 세션 토큰은 서버 데이터베이스에 해시로 보관되고 데스크톱 클라이언트에서는 메모리에 유지됩니다. 로컬 백업은 CSRIFT 앱 데이터 폴더에 보관됩니다. 어떤 보안 조치도 절대적일 수 없으며 Steam 또는 Cloudflare로 전송할 때는 해당 서비스의 네트워크 처리 위험이 따릅니다.'] },
        { title: '9. 아동 정보·변경·문의', paragraphs: ['CSRIFT는 PC 게임 관리 유틸리티이며 아동의 정보를 수집하도록 설계된 서비스가 아닙니다. 중요한 방침 변경은 앱 또는 공식 사이트에 알리고 시행일을 갱신합니다. 개인정보 문의·권리 행사·민원은 운영자 연서준에게 yydh7707@gmail.com으로 연락해 주세요. 운영자의 우편 주소는 아직 제공되지 않았으므로 공개 전에 확인해야 합니다.'] },
      ],
    },
    terms: {
      title: '서비스 이용약관',
      introduction: '시행일: 2026년 11월 16일. CSRIFT를 사용하기 전에 본 약관을 확인해 주세요.',
      sections: [
        { title: '1. 목적 및 서비스 정의', paragraphs: ['본 약관은 PC의 로컬 정보를 확인하고, 지원 게임 설치를 탐색하며, 지원되는 로컬 설정 백업을 관리하고, 선택형 Steam 계정 인증을 이용할 수 있는 Windows 유틸리티 CSRIFT의 사용을 규율합니다. CSRIFT는 게임 자체를 제공·판매·호스팅하거나 운영하지 않습니다.'] },
        { title: '2. 운영자 및 문의', paragraphs: ['CSRIFT는 대한민국의 연서준이 독립적으로 운영하며 Valve/Steam, Riot Games, Nexon 또는 게임 퍼블리셔의 공식 제품·파트너·승인 서비스가 아닙니다. 개인정보 문의는 yydh7707@gmail.com으로 보내 주세요. 운영자의 우편 주소는 제공되지 않았으므로 공개 출시 전에 확인해야 합니다.'] },
        { title: '3. 약관 효력 및 변경', paragraphs: ['이용자가 온보딩에서 약관 동의 항목을 직접 체크하고 계속 진행하면 본 약관이 적용됩니다. 앱은 이 PC에 문서 버전, 동의 시각 및 선택 언어를 기록합니다. 변경된 약관은 해당 동의가 필요한 기능을 사용하기 전에 다시 안내하고 동의를 받습니다.'] },
        { title: '4. 서비스 내용과 제공 상태', paragraphs: ['기능은 Windows 버전, 설치된 게임, 권한 및 게임 자체 소프트웨어에 따라 달라집니다. 탐지는 게임 소유, 호환성 또는 실행 성공을 보장하지 않습니다. Steam 로그인은 계정 식별자를 확인할 뿐이며 보유 게임 조회는 별개로 Steam Web API 키가 필요할 수 있고 비공개 라이브러리에서는 제공되지 않을 수 있습니다. 운영자는 유지보수·보안·법률 또는 운영상 사유로 온라인 서비스나 개별 기능을 변경·중단할 수 있습니다. 가능한 경우 로컬 기능은 계속 이용할 수 있습니다.'] },
        { title: '5. 이용자 의무 및 금지 행위', paragraphs: ['접근 권한이 있는 기기와 게임 설치에만 CSRIFT를 사용하세요. 시스템 변경을 적용하기 전에 설명과 확인 문구를 읽고 중요한 파일은 별도로 백업하세요. 법령 위반, 타인의 권리 침해, 서비스 방해, 접근 통제 또는 안티치트 우회, 게임 메모리 조작, 코드 삽입 또는 게임 보안 시스템 간섭 목적으로 CSRIFT를 사용해서는 안 됩니다. CSRIFT는 이러한 기능을 제공하도록 설계되지 않았습니다.'] },
        { title: '6. 시스템 변경 및 계정 보안', paragraphs: ['일부 명시된 도구는 시스템 또는 설정 변경을 제공할 수 있습니다. 적용 전에 변경 내용과 확인 요청을 읽으세요. 백업·복구 기능이 제공되는 경우 그 범위를 확인하세요. 전체 시스템 백업을 대체하지 않습니다. Windows 및 Steam 계정을 안전하게 관리하고 Steam 인증 정보는 Steam 공식 로그인 페이지에서만 입력하세요.'] },
        { title: '7. 지식재산권', paragraphs: ['CSRIFT 소프트웨어, 브랜드 및 독자적인 인터페이스 자료는 해당 권리자에게 귀속됩니다. 게임명·로고 등 퍼블리셔 자료는 각 권리자의 재산이며 지원 게임을 식별하기 위해서만 사용됩니다. 이용자는 본래의 개인용 PC 관리 목적에 한해 CSRIFT를 제한적으로 사용할 수 있으며 게임 라이선스나 퍼블리셔의 제휴·승인을 부여받지 않습니다.'] },
        { title: '8. 이용 제한 및 종료', paragraphs: ['운영자는 남용, 보안 위험, 법적 요구 또는 중대한 약관 위반을 처리하기 위해 합리적으로 필요한 범위에서 이용을 제한하거나 중단할 수 있습니다. 이용자는 언제든지 CSRIFT 사용을 중단하고 CSRIFT Steam 세션을 폐기할 수 있습니다. 앱 제거만으로 서버 기록이 삭제되지는 않으며, 데이터 요청은 yydh7707@gmail.com으로 보내야 합니다.'] },
        { title: '9. 면책·책임 제한·손해배상', paragraphs: ['CSRIFT는 이용 가능한 상태로 제공됩니다. 시스템 측정값, 게임 탐지 및 권장 사항은 일부 누락되거나 사용할 수 없을 수 있으며 FPS 향상, 지연 감소, 호환성 또는 무중단 서비스를 보장하지 않습니다. 관련 법령이 허용하는 범위에서 운영자는 묵시적 보증을 부인하고 앱 사용으로 인한 간접·결과적 손해에 책임을 지지 않습니다. 고의 또는 중과실 책임 등 법률상 제한할 수 없는 책임은 이 약관으로 배제되지 않습니다. 변경 내용을 확인하고 적절한 백업을 유지할 책임은 이용자에게 있습니다.'] },
        { title: '10. 준거법·분쟁 및 문의', paragraphs: ['이용자에게 강행 적용되는 소비자 보호 법규를 전제로 대한민국 법률을 준거법으로 합니다. 분쟁은 관련 대한민국 법률에 따라 관할권이 있는 법원에서 해결합니다. 개인정보 문의는 연서준에게 yydh7707@gmail.com으로 보내 주세요. 운영자의 우편 주소는 아직 제공되지 않았으므로 공개 전에 확인해야 합니다.'] },
      ],
    },
  },
  ja: {
    privacy: {
      title: 'プライバシーポリシー',
      introduction: '施行日：2026年11月16日。本ポリシーは、現在のWindowsデスクトップアプリと任意のSteamサインインにおける実際の取扱いを説明します。CSRIFTは広告・分析トラッカーを運用していません。',
      sections: [
        { title: '1. 運営者とお問い合わせ先', paragraphs: ['CSRIFTは韓国の연서준が独立して運営しており、Valve、Steam、Riot Games、Nexon、または対応ゲームのパブリッシャーとの提携・承認関係はありません。プライバシーに関するお問い合わせや請求はyydh7707@gmail.comへお送りください。運営者の郵送先住所は提供されていないため、一般公開前に確認が必要です。'] },
        { title: '2. 取り扱う情報と利用目的', paragraphs: ['CSRIFTは、このPCで選択した言語・ゲームと入力した実行ファイルのパスをローカルWebViewストレージに保存します。最近のアプリ操作概要とPing履歴（宛先アドレスおよび測定応答を含む）もローカルに保存します。オンボーディング完了状況と同意した文書のバージョン・言語・時刻は同意記録としてローカルに保存します。その他のアプリ設定と対応する設定バックアップはCSRIFTの非公開Windowsアプリデータフォルダーに保存します。これらは選択内容の保持とローカル履歴に使用し、CSRIFTサーバーへ送信しません。', 'ローカル機能の利用時に、その機能に必要な範囲でWindowsのCPU・メモリ・グラフィックス情報、実行中プロセス名、Steamライブラリのマニフェスト、対応ゲームのパス、設定ファイル名を読み取ることがあります。利用者が明示的に実行するPingテストは入力されたIPアドレスへICMPリクエストを送信します。これらの機能では、ローカルスキャン結果、プロセス情報、設定、バックアップをアップロードしません。'] },
        { title: '3. Steamサインインとサービス提供者', paragraphs: ['Steamサインインを選択すると、既定のブラウザーがSteam Communityの公式OpenIDページへ移動します。CSRIFTはSteamパスワードを要求・受信しません。CSRIFTのCloudflare WorkerがOpenID応答を検証し、17桁のSteamIDを処理します。現在のAPIエンドポイントはcsrift-api.yydh7707.workers.devで、認証サービスとデータベースはCloudflare WorkersおよびD1で稼働します。', 'サーバーにはSteamID、一般的なSteamアカウントのプロフィール参照、認証フローと再利用防止の記録、発行したセッショントークンのハッシュが保存されます。セッションは最長30日で失効し、ログアウトが成功すると無効化されます。Cloudflareのリクエストメタデータには接続元IPが含まれます。Workerはレート制限のためにIPをハッシュ化し、Steamパスワード、セッショントークン、OpenIDの認証応答値を意図的にログへ記録しません。', 'Steamアカウントが所有するゲームと、このPCにインストールされたゲームは別の情報です。OpenIDサインインだけでは所有ゲーム一覧、ニックネーム、アバターを取得できません。所有ゲームの照会は独立した任意のSteam Web API機能であり、運営者がSteam APIキーを設定し、Steamがライブラリ情報を提供する場合に限り利用できます。利用可能な場合、ゲーム名、App ID、アイコン、プレイ時間はD1にキャッシュされ、15分後に更新されることがあります。現在、そのキャッシュに対する自動削除スケジュールはありません。照会できない場合、一覧を取得したかのように表示しません。SteamとCloudflareは各社の規約およびプライバシー通知に従って情報を処理します。'] },
        { title: '4. 取得方法と第三者提供', paragraphs: ['アプリの選択内容や実行ファイルのパスは利用者が直接入力します。Windows情報は該当するCSRIFT機能を開く、または実行したときにこのPC上で読み取ります。Steamアカウント情報は、利用者がサインインを開始し、検証済みSteam OpenID応答を受け取った場合にのみ処理します。CSRIFTは個人情報を販売せず、ローカルスキャン結果をゲームパブリッシャーへ提供しません。要求されたサインインまたは任意のサーバー機能に必要な情報のみSteamおよびCloudflareへ送信されます。'] },
        { title: '5. 保存期間と削除', paragraphs: ['WebViewの選択情報、操作・Ping履歴、同意記録はCSRIFTのWebView/アプリデータを消去するか、アプリデータを削除するまでWindowsユーザープロファイルに残ります。アプリ設定とローカルバックアップはCSRIFTの非公開アプリデータフォルダーに保存され、同フォルダーまたはCSRIFTのバックアップ管理機能から削除するまで保持されます。ローカル記録を消去すると、この端末上の同意記録も失われます。', 'サーバー側のSteamセッションは最長30日有効で、ログアウトにより失効できます。Steamアカウント識別情報と認証運用記録は、認証・リプレイ防止・不正利用防止のためCloudflare D1に保存されます。現在、利用者自身がサーバー上のアカウントデータを削除するAPIや、期限切れ運用記録および古い所有ゲームキャッシュに対する公開済み自動削除スケジュールはありません。サーバーデータの開示・削除請求はyydh7707@gmail.comへお送りください。運営者が手動で対応する必要があります。'] },
        { title: '6. 利用者の権利と選択', paragraphs: ['Steam連携は任意であり、連携しなくてもローカルゲーム検出やWindowsモニタリングを利用できます。CSRIFTのセッションはいつでも解除できます。設定で言語を変更し、文書を再確認できます。韓国の個人情報保護法を含む適用法令に従い、個人情報の開示・訂正・削除・処理停止を請求し、プライバシーに関する問い合わせをyydh7707@gmail.comへ送ることができます。ローカルデータはCSRIFTアプリデータの消去で削除できますが、サーバー記録は削除されません。'] },
        { title: '7. Cookie・端末情報・自動取得', paragraphs: ['Windowsデスクトップアプリは広告Cookieを設定せず、分析または広告SDKも含みません。アプリのWebViewストレージはローカル設定、オンボーディング、同意記録に使用します。端末・システム情報は表示中のローカル機能に必要な範囲でのみ読み取ります。WorkerはIPアドレスを含む標準的なネットワークリクエスト情報を受け取り、レート制限のため一方向ハッシュを使用します。アプリをまたぐ追跡プロファイルは作成しません。'] },
        { title: '8. 安全管理', paragraphs: ['Steam認証はサーバーがOpenID 2.0で検証し、アプリはSteamパスワードを扱いません。セッショントークンはサーバーデータベースにハッシュで保存され、デスクトップクライアントではメモリ上に保持されます。ローカルバックアップはCSRIFTのアプリデータフォルダーに保存されます。絶対的な安全対策はなく、SteamまたはCloudflareへの送信には各サービスのネットワーク処理に伴うリスクがあります。'] },
        { title: '9. 未成年者・変更・お問い合わせ', paragraphs: ['CSRIFTはPCゲーム管理ユーティリティであり、子どもの情報を収集する目的のサービスではありません。重要なポリシー変更はアプリまたは公式サイトで告知し、施行日を更新します。プライバシーに関する質問、権利請求、苦情は運営者の연서준（yydh7707@gmail.com）へご連絡ください。運営者の郵送先住所は未提供のため、一般公開前に確認が必要です。'] },
      ],
    },
    terms: {
      title: '利用規約',
      introduction: '施行日：2026年11月16日。CSRIFTを利用する前に本規約をご確認ください。',
      sections: [
        { title: '1. 目的とサービス', paragraphs: ['本規約は、PCのローカル情報の表示、対応ゲームのインストール検出、対応するローカル設定バックアップの管理、任意のSteamアカウント認証を提供するWindowsユーティリティCSRIFTの利用条件を定めます。CSRIFTはゲーム自体を提供、販売、ホストまたは運営しません。'] },
        { title: '2. 運営者と連絡先', paragraphs: ['CSRIFTは韓国の연서준が独立して運営しており、Valve/Steam、Riot Games、Nexonまたはゲームパブリッシャーの公式製品・パートナー・承認サービスではありません。プライバシーに関するお問い合わせはyydh7707@gmail.comへお送りください。運営者の郵送先住所は提供されていないため、一般公開前に確認が必要です。'] },
        { title: '3. 規約の効力と変更', paragraphs: ['オンボーディングで利用者が規約同意欄に自らチェックして続行した時点で、本規約が適用されます。アプリは文書バージョン、同意時刻、選択言語をこのPCに記録します。変更後の規約は、その同意が必要な機能を利用する前に提示し、再度同意を得ます。'] },
        { title: '4. 機能と提供状況', paragraphs: ['機能はWindowsのバージョン、インストール済みゲーム、権限、ゲーム自体のソフトウェアにより異なります。検出は所有権、互換性、起動成功を保証しません。Steamサインインで確認できるのはアカウント識別子のみで、所有ゲーム照会は別機能です。Steam Web APIキーが必要な場合があり、非公開ライブラリでは利用できないことがあります。運営者は保守・セキュリティ・法令・運用上の理由でオンラインサービスや機能を変更または停止することがあります。可能な範囲でローカル機能は継続します。'] },
        { title: '5. 利用者の責任と禁止事項', paragraphs: ['アクセス権のある端末およびゲームインストールにのみCSRIFTを使用してください。システム変更の説明と確認表示を読み、重要なファイルは別途バックアップしてください。法令違反、第三者の権利侵害、サービス妨害、アクセス制御またはアンチチート保護の回避、ゲームメモリ操作、コード注入、ゲームセキュリティへの干渉にCSRIFTを使用してはなりません。CSRIFTはこれらの機能を提供する目的で設計されていません。'] },
        { title: '6. システム変更とアカウント保護', paragraphs: ['明示された一部のツールはシステムまたは設定の変更を提案する場合があります。適用前に説明と確認画面を確認してください。バックアップ・復元機能がある場合も対象範囲を確認してください。完全なシステムバックアップの代わりにはなりません。WindowsおよびSteamアカウントを安全に管理し、Steam認証情報はSteam公式サインインページにのみ入力してください。'] },
        { title: '7. 知的財産権', paragraphs: ['CSRIFTソフトウェア、ブランド、独自のインターフェース素材は各権利者に帰属します。ゲーム名、ロゴ等のパブリッシャー素材は各権利者の財産であり、対応ゲームの識別目的でのみ使用します。利用者には本来の個人向けPC管理目的でCSRIFTを使う限定的な権利が付与されますが、ゲームライセンスやパブリッシャーの提携・承認は付与されません。'] },
        { title: '8. 利用制限と終了', paragraphs: ['運営者は不正利用、セキュリティリスク、法的要件または重大な規約違反への対応に合理的に必要な場合、利用を制限または停止できます。利用者はいつでもCSRIFTの使用をやめ、CSRIFTのSteamセッションを無効化できます。アプリを削除してもサーバー記録は自動的に削除されません。データ請求はyydh7707@gmail.comへお送りください。'] },
        { title: '9. 免責・責任制限・損害', paragraphs: ['CSRIFTは利用可能な状態で提供されます。システム計測、ゲーム検出、推奨事項は不完全または利用不能な場合があり、FPS向上、遅延低減、互換性、無停止の提供を保証しません。適用法で認められる範囲において、運営者は黙示の保証を否認し、アプリ利用に起因する間接損害・結果的損害に責任を負いません。故意または重大な過失に関する責任など、法律上免責できない責任は本規約で排除されません。変更内容を確認し、適切なバックアップを維持する責任は利用者にあります。'] },
        { title: '10. 準拠法・紛争・お問い合わせ', paragraphs: ['利用者に強制適用される消費者保護法令を前提として、大韓民国の法律を準拠法とします。紛争は韓国法に基づき管轄権を有する裁判所で解決します。プライバシーに関するお問い合わせは연서준（yydh7707@gmail.com）へお送りください。運営者の郵送先住所は未提供のため、一般公開前に確認が必要です。'] },
      ],
    },
  },
}

function getDocuments(language: AppLanguage) {
  return documents[language]
}

function LegalBody({ document, language }: { document: LegalDocument; language: AppLanguage }) {
  const pendingNotice = language === 'ko'
    ? '출시 전 확인 필요: 운영자의 우편 주소는 제공되지 않았습니다. 공개 전 공개 의무와 대체 문의처 요건을 확인하세요.'
    : language === 'ja'
      ? '公開前に確認が必要です：運営者の郵送先住所は未提供です。公開義務と代替の問い合わせ方法を確認してください。'
      : 'Confirmation required before release: no postal address was provided. Confirm address disclosure requirements and any permitted alternative contact method.'
  return (
    <article className="legal-document-body" lang={language}>
      <div className="legal-effective-date">{language === 'ko' ? '시행일' : language === 'ja' ? '施行日' : 'EFFECTIVE DATE'} · {LEGAL_VERSION}</div>
      <p className="legal-intro">{document.introduction}</p>
      <p className="legal-pending-notice">{pendingNotice}</p>
      {document.sections.map((section) => <section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
    </article>
  )
}

const ui = {
  en: {
    language: 'CHOOSE YOUR LANGUAGE', languageDetail: 'You can change this later in Settings.',
    legal: 'PRIVACY & TERMS', legalDetail: 'Read both documents. Accept each one to continue.',
    privacy: 'Privacy Policy', terms: 'Terms of Service',
    privacyCheck: 'I have read and agree to the Privacy Policy.', termsCheck: 'I have read and agree to the Terms of Service.',
    back: 'BACK', continue: 'ACCEPT & CONTINUE', required: 'Both documents must be accepted to continue.',
    steamTitle: 'CONNECT YOUR STEAM ACCOUNT', steamDescription: 'Connect your Steam account to enjoy a more seamless gaming experience with CSRIFT.',
    steamConnected: 'STEAM ACCOUNT VERIFIED', steamConnectedDescription: 'Your Steam identity was verified by Steam. Owned-game lookup is separate and may not be available.',
    connect: 'CONNECT STEAM', connecting: 'WAITING FOR STEAM', skip: 'SKIP FOR NOW',
    retry: 'RETRY', introLine: 'ONE PLATFORM. EVERY GAME.', enter: 'ENTER CSRIFT', introSkip: 'SKIP INTRO',
    footer: '© 2026 CSRIFT. All rights reserved.', storageError: 'Your onboarding choice could not be saved on this device. Check app storage and retry.',
    steamError: 'Steam sign-in did not finish. You can retry or continue without connecting.',
  },
  ko: {
    language: '언어를 선택하세요', languageDetail: '언어는 설정에서 나중에 변경할 수 있습니다.',
    legal: '개인정보 처리방침 및 이용약관', legalDetail: '두 문서를 확인하고 각각 동의해야 계속할 수 있습니다.',
    privacy: '개인정보 처리방침', terms: '서비스 이용약관',
    privacyCheck: '개인정보 처리방침을 확인하고 동의합니다.', termsCheck: '이용약관을 확인하고 동의합니다.',
    back: '뒤로', continue: '동의하고 계속', required: '계속하려면 두 문서에 모두 동의해야 합니다.',
    steamTitle: 'Steam 계정 연결', steamDescription: 'Steam 계정을 연결하면 CSRIFT에서 지원되는 게임 라이브러리를 더욱 편리하게 확인하고 관리할 수 있습니다.',
    steamConnected: 'STEAM 계정 인증 완료', steamConnectedDescription: 'Steam에서 계정 인증을 완료했습니다. 보유 게임 조회는 별도 기능이며 제공되지 않을 수 있습니다.',
    connect: 'STEAM 연결', connecting: 'STEAM 인증 대기 중', skip: '지금은 건너뛰기',
    retry: '다시 시도', introLine: '하나의 플랫폼. 모든 게임.', enter: 'CSRIFT 시작', introSkip: '인트로 건너뛰기',
    footer: '© 2026 CSRIFT. All rights reserved.', storageError: '온보딩 선택을 이 기기에 저장하지 못했습니다. 앱 저장 공간을 확인한 후 다시 시도해 주세요.',
    steamError: 'Steam 로그인이 완료되지 않았습니다. 다시 시도하거나 연결하지 않고 계속할 수 있습니다.',
  },
  ja: {
    language: '言語を選択', languageDetail: '言語は後から設定で変更できます。',
    legal: 'プライバシーと利用規約', legalDetail: '両方の文書を確認し、それぞれに同意して続行してください。',
    privacy: 'プライバシーポリシー', terms: '利用規約',
    privacyCheck: 'プライバシーポリシーを読み、同意します。', termsCheck: '利用規約を読み、同意します。',
    back: '戻る', continue: '同意して続行', required: '続行するには両方の文書への同意が必要です。',
    steamTitle: 'Steamアカウントを接続', steamDescription: 'Steamアカウントを接続すると、CSRIFTで対応ゲームのライブラリをより便利に確認・管理できます。',
    steamConnected: 'STEAMアカウント認証済み', steamConnectedDescription: 'Steamによるアカウント認証が完了しました。所有ゲームの照会は別機能であり、利用できない場合があります。',
    connect: 'STEAMを接続', connecting: 'STEAM認証を待機中', skip: '今はスキップ',
    retry: '再試行', introLine: 'ひとつのプラットフォーム。すべてのゲーム。', enter: 'CSRIFTを開始', introSkip: 'イントロをスキップ',
    footer: '© 2026 CSRIFT. All rights reserved.', storageError: 'オンボーディングの選択をこの端末に保存できませんでした。アプリのストレージを確認して再試行してください。',
    steamError: 'Steamサインインが完了しませんでした。再試行するか、接続せずに続行できます。',
  },
} as const

const languageNames: Record<AppLanguage, { label: string; native: string }> = {
  en: { label: 'ENGLISH', native: 'English' },
  ko: { label: '한국어', native: '한국어' },
  ja: { label: '日本語', native: '日本語' },
}

type OnboardingProps = {
  progress: OnboardingProgress
  language: AppLanguage
  steamConnected: boolean
  steamStage: string | null
  steamError: string | null
  reduceMotion: boolean
  storageError: boolean
  onChooseLanguage: (language: AppLanguage) => void
  onAcceptLegal: (consent: LegalConsent) => void
  onConnectSteam: () => void
  onSkipSteam: () => void
  onFinish: () => void
  onBackToLanguage: () => void
}

export function OnboardingFlow({
  progress, language, steamConnected, steamStage, steamError, reduceMotion, storageError,
  onChooseLanguage, onAcceptLegal, onConnectSteam, onSkipSteam, onFinish, onBackToLanguage,
}: OnboardingProps) {
  const [documentTab, setDocumentTab] = useState<'privacy' | 'terms'>('privacy')
  const [privacyChecked, setPrivacyChecked] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const copy = ui[language]
  const docs = getDocuments(language)
  const busy = steamStage === 'preparing' || steamStage === 'waiting'

  useEffect(() => {
    if (progress.step !== 'intro') return
    const timer = window.setTimeout(onFinish, reduceMotion ? 1500 : 7600)
    return () => window.clearTimeout(timer)
  }, [onFinish, progress.step, reduceMotion])

  const acceptLegal = () => {
    if (!privacyChecked || !termsChecked) return
    onAcceptLegal({
      privacyVersion: LEGAL_VERSION,
      termsVersion: LEGAL_VERSION,
      consentedAt: new Date().toISOString(),
      language,
    })
  }

  return (
    <motion.div className="onboarding-screen" role="dialog" aria-modal="true" aria-label="CSRIFT first launch setup" lang={language} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.1 : 0.35 }}>
      <div className="onboarding-ambient" />
      {progress.step !== 'intro' && <header className="onboarding-brand"><span className="onboarding-brand-mark">C</span><b>CSRIFT</b><span>FIRST LAUNCH / {String(['language', 'legal', 'steam'].indexOf(progress.step) + 1).padStart(2, '0')} — 03</span></header>}

      <AnimatePresence mode="wait" initial={false}>
        {progress.step === 'language' && (
          <motion.main key="language" className="onboarding-panel language-panel" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? .1 : .24 }}>
            <span className="onboarding-kicker"><i /> CSRIFT / INITIAL SETUP</span>
            <h1>{copy.language}</h1>
            <p>{copy.languageDetail}</p>
            <div className="language-options">{(Object.keys(languageNames) as AppLanguage[]).map((option) => (
              <button key={option} className="language-option" onClick={() => onChooseLanguage(option)}>
                <span className="language-option-code">{option.toUpperCase()}</span><span><b>{languageNames[option].label}</b><small>{languageNames[option].native}</small></span><ChevronRight size={17} />
              </button>
            ))}</div>
            {storageError && <p className="onboarding-error" role="alert">{copy.storageError}</p>}
          </motion.main>
        )}

        {progress.step === 'legal' && (
          <motion.main key="legal" className="onboarding-panel legal-panel" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? .1 : .24 }}>
            <span className="onboarding-kicker"><i /> STEP 02 / REQUIRED REVIEW</span>
            <h1>{copy.legal}</h1>
            <p>{copy.legalDetail}</p>
            <div className="legal-tabs" role="tablist">
              <button role="tab" aria-selected={documentTab === 'privacy'} className={documentTab === 'privacy' ? 'is-selected' : ''} onClick={() => setDocumentTab('privacy')}><ShieldCheck size={14} />{copy.privacy}</button>
              <button role="tab" aria-selected={documentTab === 'terms'} className={documentTab === 'terms' ? 'is-selected' : ''} onClick={() => setDocumentTab('terms')}>{copy.terms}</button>
            </div>
            <div className="legal-scroll" role="tabpanel" key={documentTab} tabIndex={0}>
              <LegalBody document={docs[documentTab]} language={language} />
            </div>
            <div className="legal-consents">
              <label><input type="checkbox" checked={privacyChecked} onChange={(event) => setPrivacyChecked(event.target.checked)} /><span><Check size={12} /></span>{copy.privacyCheck}</label>
              <label><input type="checkbox" checked={termsChecked} onChange={(event) => setTermsChecked(event.target.checked)} /><span><Check size={12} /></span>{copy.termsCheck}</label>
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-text-button" onClick={onBackToLanguage}><ChevronLeft size={15} />{copy.back}</button>
              <button className="onboarding-primary" disabled={!privacyChecked || !termsChecked} onClick={acceptLegal}>{copy.continue}<ChevronRight size={15} /></button>
            </div>
            {storageError && <p className="onboarding-error" role="alert">{copy.storageError}</p>}
            {!privacyChecked || !termsChecked ? <small className="legal-required">{copy.required}</small> : null}
          </motion.main>
        )}

        {progress.step === 'steam' && (
          <motion.main key="steam" className="onboarding-panel steam-onboarding-panel" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? .1 : .24 }}>
            <span className="onboarding-kicker"><i /> STEP 03 / OPTIONAL CONNECTION</span>
            <div className="onboarding-steam-mark" aria-hidden="true"><img src="/images/steam-logo-circle.png" alt="" /></div>
            <h1>{steamConnected ? copy.steamConnected : copy.steamTitle}</h1>
            <p>{steamConnected ? copy.steamConnectedDescription : copy.steamDescription}</p>
            {steamError && <div className="onboarding-error" role="alert">{copy.steamError}<small>{steamError}</small></div>}
            {storageError && <p className="onboarding-error" role="alert">{copy.storageError}</p>}
            <div className="onboarding-steam-actions">
              {!steamConnected && <button className="onboarding-primary" disabled={busy} onClick={onConnectSteam}>{busy ? <span className="onboarding-spinner" /> : null}{busy ? copy.connecting : copy.connect}<ChevronRight size={15} /></button>}
              <button className="onboarding-secondary" onClick={onSkipSteam}>{steamConnected ? copy.continue : copy.skip}</button>
            </div>
            <small className="onboarding-optional-note">Steam authentication is optional. Local game detection does not require a Steam API key.</small>
          </motion.main>
        )}

        {progress.step === 'intro' && (
          <motion.main key="intro" className="onboarding-cinematic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .1 : .7 }}>
            <motion.div className="cinematic-vignette" initial={{ opacity: 1 }} animate={{ opacity: 1 }} />
            <motion.div className="cinematic-eye-window" initial={{ opacity: 0, scale: reduceMotion ? 1 : .92, filter: 'blur(10px)', clipPath: 'inset(48% 0 48%)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', clipPath: 'inset(0% 0 0%)' }} transition={{ duration: reduceMotion ? .25 : 2.6, ease: [0.22, 1, 0.36, 1] }}>
              <img src="/images/csrift-eyes-cutout.png" alt="" />
            </motion.div>
            {!reduceMotion && <motion.div className="cinematic-light-sweep" initial={{ x: '-120%', opacity: 0 }} animate={{ x: '120%', opacity: [0, .8, 0] }} transition={{ delay: 2.9, duration: 1.15, ease: 'easeInOut' }} />}
            <motion.div className="cinematic-wordmark" initial={{ opacity: 0, filter: 'blur(12px)', y: 10 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }} transition={{ delay: reduceMotion ? .3 : 3.1, duration: reduceMotion ? .25 : 1 }}>
              <b>CSRIFT</b><span>{copy.introLine}</span>
            </motion.div>
            <button className="cinematic-skip" onClick={onFinish}>{copy.introSkip}<ChevronRight size={13} /></button>
          </motion.main>
        )}
      </AnimatePresence>

      {progress.step !== 'intro' && <footer className="onboarding-footer">{copy.footer}</footer>}
      {progress.step === 'intro' && <span className="cinematic-footer">{copy.footer}</span>}
    </motion.div>
  )
}

type LegalDialogProps = { language: AppLanguage; initialTab?: 'privacy' | 'terms'; onClose: () => void }

export function LegalDocumentsDialog({ language, initialTab = 'privacy', onClose }: LegalDialogProps) {
  const [tab, setTab] = useState(initialTab)
  const copy = ui[language]
  const docs = getDocuments(language)
  return (
    <motion.div className="legal-dialog-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.section className="legal-dialog" role="dialog" aria-modal="true" aria-label={`${copy.privacy} / ${copy.terms}`} lang={language} initial={{ opacity: 0, y: 14, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .99 }} onClick={(event) => event.stopPropagation()}>
        <header><span><small>CSRIFT / LEGAL</small><h2>{tab === 'privacy' ? copy.privacy : copy.terms}</h2></span><button aria-label="Close" onClick={onClose}><X size={17} /></button></header>
        <div className="legal-tabs" role="tablist"><button role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'is-selected' : ''} onClick={() => setTab('privacy')}>{copy.privacy}</button><button role="tab" aria-selected={tab === 'terms'} className={tab === 'terms' ? 'is-selected' : ''} onClick={() => setTab('terms')}>{copy.terms}</button></div>
        <div className="legal-scroll" role="tabpanel" key={tab} tabIndex={0}><LegalBody document={docs[tab]} language={language} /></div>
        <footer>{copy.footer}</footer>
      </motion.section>
    </motion.div>
  )
}
