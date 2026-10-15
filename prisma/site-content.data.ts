/**
 * DigiEmporia's approved website copy (15 October 2026): the six service
 * pages and the Delhi and Gurgaon service-city pages.
 *
 * Generated from the approved content doc; edit the live copy in the admin,
 * not here. prisma/site-content.ts writes it over demo and starter
 * placeholders only.
 */

export type ServiceContent = {
  slug: string;
  name: string;
  shortDescription: string;
  body: { intro: string; deliverables: string[]; approach: string };
  metaTitle: string;
  metaDescription: string;
  faqs: { question: string; answer: string }[];
};

export type ServiceCityContent = {
  serviceSlug: string;
  localIntro: string;
  marketContext: string;
  industries: string[];
  positioning: string;
  ctaHeading: string;
  ctaBody: string;
  metaTitle: string;
  metaDescription: string;
  faqs: { question: string; answer: string }[];
};

export type CityContent = { slug: string; metaTitle: string; metaDescription: string; pages: ServiceCityContent[] };

export const SERVICES: ServiceContent[] = [
  {
    "slug": "seo",
    "name": "Search Engine Optimisation (SEO)",
    "shortDescription": "Get found by people already searching for what you sell. Technical fixes, content mapped to real search demand, and local SEO, reported against enquiries, not just rankings.",
    "body": {
      "intro": "Your customers search on Google before they call anyone. If your pages don't show up for those searches, the enquiry goes to a competitor. We start by finding out what your buyers actually type, then fix whatever stops your site from ranking for those searches, and build the pages and authority to hold the position.\n\nSEO compounds slowly. Technical fixes can move things within weeks; content and authority take months. We tell you that up front, and we show you the progress every month in plain numbers from your own Google Search Console and Google Analytics.",
      "deliverables": [
        "Technical SEO audit: speed, indexing, crawl errors, mobile and Core Web Vitals",
        "Keyword and search-intent research mapped to your service and location pages",
        "On-page optimisation: titles, meta descriptions, headings, internal links and schema markup",
        "Local SEO: Google Business Profile optimisation, posts and review management",
        "Service and city landing pages written for real local demand",
        "Blog and content plan based on what your buyers search for",
        "Link building through genuine mentions and listings, no paid link schemes",
        "Monthly report from your Search Console and GA4 data: clicks, queries, pages and enquiries"
      ],
      "approach": "We start with a one-time audit and a 90-day plan. Month one fixes what is broken. Months two and three build the missing pages and content. After that we review the data every month, double down on what brings enquiries and drop what doesn't. You see every report in your client portal, and nothing goes live on your site without your approval.\n\nPricing depends on your site size, competition and number of locations, and is set out in a written proposal."
    },
    "metaTitle": "SEO Services in Delhi",
    "metaDescription": "SEO that brings enquiries, not just rankings. Technical SEO, local SEO, content and monthly reporting from your own Google data. Talk to us.",
    "faqs": [
      {
        "question": "How long does SEO take to show results?",
        "answer": "Technical fixes can show movement within a few weeks. Content and authority usually take 3 to 6 months to build a clear upward trend, depending on your competition."
      },
      {
        "question": "Do you guarantee first-page rankings?",
        "answer": "No. Nobody controls Google's rankings, and anyone who guarantees them is taking a risk with your site. We commit to the work, the plan and transparent reporting."
      },
      {
        "question": "Will I own the content and pages you create?",
        "answer": "Yes. Once the related invoices are paid, everything we create for your site is yours."
      },
      {
        "question": "Do you work on local SEO for my city?",
        "answer": "Yes. We optimise your Google Business Profile and build city pages only where we can write genuinely useful local content."
      }
    ]
  },
  {
    "slug": "paid-media",
    "name": "Paid Media (Google Ads and Meta Ads)",
    "shortDescription": "Google Ads and Meta Ads managed against the number that matters to you: cost per qualified enquiry. Clear tracking, honest reporting, and no wasted budget on clicks that never convert.",
    "body": {
      "intro": "Ad platforms make it easy to spend money and hard to know what it bought. We set up conversion tracking first, so every rupee can be traced to a form fill, a call or a sale. Then we build campaigns around what your buyers search for and who they are.\n\nYour ad budget is paid directly to Google or Meta from your own ad account. You keep full ownership and access to the account, the data and the campaigns, always.",
      "deliverables": [
        "Account audit and conversion tracking setup (GA4, Google Tag Manager, Meta Pixel)",
        "Google Search, Performance Max, Display and YouTube campaigns",
        "Meta (Facebook and Instagram) lead generation and remarketing campaigns",
        "Keyword research, negative keywords and audience targeting",
        "Ad copy and creative briefs, with A/B testing",
        "Landing page recommendations to lift conversion rate",
        "Weekly budget and bid optimisation",
        "Monthly report: spend, enquiries, cost per enquiry and what we changed"
      ],
      "approach": "We start with tracking. Without it, optimisation is guesswork. The first month is a learning phase: we test audiences, keywords and ads at a controlled budget. From month two we move spend towards what produces qualified enquiries and cut what doesn't. You approve every new campaign and every budget change before it goes live.\n\nOur management fee is separate from your ad spend. Both are set out in a written proposal."
    },
    "metaTitle": "Google Ads & Meta Ads Management",
    "metaDescription": "Google Ads and Meta Ads managed for cost per qualified enquiry, with proper conversion tracking and your own ad account. Talk to us.",
    "faqs": [
      {
        "question": "What budget do I need to start?",
        "answer": "It depends on your industry and city. We recommend a budget in the proposal after looking at competition and cost per click for your keywords."
      },
      {
        "question": "Who owns the ad account?",
        "answer": "You do. Campaigns run in your own Google Ads and Meta Business accounts, and we work with access you grant."
      },
      {
        "question": "How soon will I get leads?",
        "answer": "Ads can bring enquiries within days of going live, but the first 2 to 4 weeks are for learning what works. Cost per enquiry usually improves after that."
      },
      {
        "question": "Is ad spend included in your fee?",
        "answer": "No. Ad spend is paid directly to Google or Meta. Our fee covers strategy, setup and management."
      }
    ]
  },
  {
    "slug": "social-media",
    "name": "Social Media Management",
    "shortDescription": "A consistent, on-brand presence on Instagram, Facebook, LinkedIn, X, YouTube and Google Business Profile. Planned monthly, approved by you, published on schedule and reported honestly.",
    "body": {
      "intro": "Posting when someone remembers to isn't a strategy. We plan a month of content around your business goals, your offers and the moments that matter to your customers. We design and write every post, and publish it on schedule.\n\nYou see the whole calendar in your client portal. You approve or request changes on each post before anything is published. You can connect your own accounts securely from the portal, and we never ask for your passwords.",
      "deliverables": [
        "Monthly content strategy and calendar",
        "Post design: static, carousel and short-form video (Reels and Shorts)",
        "Captions, hashtags and first comments written for each platform",
        "Approval workflow in your client portal before anything goes live",
        "Scheduled publishing on Instagram, Facebook, LinkedIn, X, YouTube and Google Business Profile",
        "Festival and occasion posts planned in advance",
        "Profile setup and optimisation",
        "Monthly report on reach, engagement and follower growth from the platforms' own data"
      ],
      "approach": "In the first week we learn your brand, audience and competitors, and agree a tone of voice. Each month we send the next month's calendar for approval. Approved posts are scheduled and published automatically. At month end you get a report pulled from the platforms' own insights, with what worked and what we will change.\n\nThe number of posts and platforms per month is agreed in your proposal."
    },
    "metaTitle": "Social Media Management Agency in Delhi",
    "metaDescription": "Planned, designed and scheduled social media for Instagram, Facebook, LinkedIn, X and YouTube, with client approval on every post. Talk to us.",
    "faqs": [
      {
        "question": "Do I get to approve posts before they go live?",
        "answer": "Yes. Every post goes to your client portal for approval. Nothing is published without it."
      },
      {
        "question": "Do you need my social media passwords?",
        "answer": "No. You connect your accounts through each platform's official sign-in from your client portal. You can disconnect them any time."
      },
      {
        "question": "Do you reply to comments and messages?",
        "answer": "Community management can be added to your plan. It is agreed in the proposal."
      },
      {
        "question": "Is paid promotion included?",
        "answer": "No. Boosting posts or running ads is part of our Paid Media service, and ad spend is separate."
      }
    ]
  },
  {
    "slug": "content-marketing",
    "name": "Content Marketing",
    "shortDescription": "Blogs, guides, website copy and email content that answer your buyers' real questions, so they find you on Google and trust you before they ever call.",
    "body": {
      "intro": "Buyers research before they enquire. The business that answers their questions clearly, on its own website, earns the visit and often the enquiry. We plan content around the questions your customers actually ask and what they search on Google. Then we write it in your brand's voice.\n\nEvery piece is researched, edited and checked before it reaches you. AI tools may help us draft, but a person writes, checks and edits everything, and nothing is published without your approval.",
      "deliverables": [
        "Content strategy based on keyword research and customer questions",
        "Monthly editorial calendar",
        "SEO blog posts and long-form guides",
        "Website and landing page copywriting",
        "Service and city page content",
        "Email newsletters",
        "Repurposing articles into social media posts",
        "Monthly report on traffic and enquiries from each piece, using your GA4 data"
      ],
      "approach": "We start with a content audit and a list of topics ranked by search demand and business value. Each month we agree the topics, write and edit the pieces, and send them for your approval in the client portal. After publishing, we track which pieces bring visitors and enquiries, and plan the next month from that.\n\nThe number and length of pieces per month is agreed in your proposal."
    },
    "metaTitle": "Content Marketing & Copywriting Services",
    "metaDescription": "Blogs, guides and website copy planned around what your buyers search for, written in your voice and approved by you before publishing.",
    "faqs": [
      {
        "question": "Who writes the content?",
        "answer": "Our writers and editors. AI tools may assist with research and first drafts, but every piece is written, fact-checked and edited by a person."
      },
      {
        "question": "Will the content be original?",
        "answer": "Yes. Everything is written for you and checked for plagiarism before delivery."
      },
      {
        "question": "Can you write in Hindi?",
        "answer": "Tell us your audience and languages in the brief, and we will confirm in the proposal."
      },
      {
        "question": "Who owns the content?",
        "answer": "You do, once the related invoices are paid."
      }
    ]
  },
  {
    "slug": "web-design-development",
    "name": "Web Design & Development",
    "shortDescription": "Fast, mobile-first websites and landing pages built to turn visitors into enquiries. Clean design, SEO-ready structure, and a site your team can update without calling a developer.",
    "body": {
      "intro": "Your website is usually the first place a customer judges your business. A slow, confusing or outdated site loses enquiries before anyone reads a word. We design and build sites around one job: helping the right visitor understand what you do and get in touch.\n\nEvery site we build is mobile-first, fast, secure and set up for SEO and tracking from day one. You get a content management system, so your team can edit pages, add blog posts and change details without waiting on us.",
      "deliverables": [
        "Discovery: goals, audience, competitors and sitemap",
        "Wireframes and visual design for desktop and mobile",
        "Responsive development with a content management system",
        "Landing pages for campaigns and lead generation",
        "Contact forms and lead capture connected to your email or CRM",
        "On-page SEO setup: page titles, meta tags, sitemap, schema and redirects",
        "GA4, Google Tag Manager and conversion tracking setup",
        "Speed, security (HTTPS) and accessibility checks before launch",
        "Training for your team, plus a support period after launch"
      ],
      "approach": "We work in clear stages: discovery, design, build, review and launch. You approve the design before development starts, and you review the site on a staging link before it goes live. If you are replacing an old site, we redirect old pages to the new ones, so you keep the search visibility you already have.\n\nTimelines and pricing depend on the number of pages and features, and are set out in a written proposal."
    },
    "metaTitle": "Website Design & Development Company in Delhi",
    "metaDescription": "Fast, mobile-first websites and landing pages built for enquiries, SEO-ready from day one, with a CMS your team can edit. Talk to us.",
    "faqs": [
      {
        "question": "How long does a website take?",
        "answer": "A landing page can take one to two weeks. A full business website usually takes four to eight weeks, depending on pages, features and how quickly content is ready."
      },
      {
        "question": "Will I be able to edit the website myself?",
        "answer": "Yes. Every site comes with a content management system and training for your team."
      },
      {
        "question": "Do you redesign existing websites?",
        "answer": "Yes. We keep your existing search rankings safe with proper redirects and SEO checks during the move."
      },
      {
        "question": "Who owns the website?",
        "answer": "You do, including the domain, the design and the content, once the related invoices are paid."
      }
    ]
  },
  {
    "slug": "marketing-analytics",
    "name": "Marketing Analytics",
    "shortDescription": "Know exactly which channels, campaigns and pages bring your enquiries. Clean tracking, clear dashboards and monthly insight, built on your own Google Analytics, Search Console and ad data.",
    "body": {
      "intro": "Most businesses spend on marketing without knowing what is working. Clicks and likes are easy to count. Enquiries and sales by channel are what actually matter. We set up tracking that follows a visitor from the ad, post or search that brought them to the form or call that made them a lead.\n\nAll reporting runs on your own accounts: GA4, Google Search Console, Google Ads and Meta. You always own the data. We never put numbers in a report that don't come from those sources.",
      "deliverables": [
        "Tracking audit of your website, forms, calls and ad accounts",
        "GA4 and Google Tag Manager setup, with conversion events",
        "UTM tagging standards for every campaign and channel",
        "Lead source attribution, from first visit to enquiry",
        "Google Search Console setup and monitoring",
        "Live dashboards in your client portal",
        "Monthly insight report: what worked, what didn't and what to change",
        "Quarterly review of marketing spend against enquiries"
      ],
      "approach": "We start with an audit of what is tracked today and what is missing or broken. Next we fix the setup and agree the few numbers that matter most to your business, such as enquiries by source and cost per enquiry. From then on, you see those numbers in your client portal and get a monthly report with clear recommendations.\n\nAnalytics setup can be a one-time project or part of an ongoing plan, and is set out in a written proposal."
    },
    "metaTitle": "Marketing Analytics & GA4 Setup Services",
    "metaDescription": "GA4, Tag Manager, UTM and conversion tracking set up properly, with dashboards that show which channels bring your enquiries. Talk to us.",
    "faqs": [
      {
        "question": "I already have Google Analytics. Do I need this?",
        "answer": "Often, yes. Many GA4 setups track page views but not forms, calls or lead sources. We audit what you have and fix only what is missing."
      },
      {
        "question": "Who owns the data?",
        "answer": "You do. Everything runs on your own Google and Meta accounts, and we work with access you grant."
      },
      {
        "question": "Can you show which ads or posts bring enquiries?",
        "answer": "Yes, once tracking and UTM tagging are in place. We show it in your dashboard and monthly report."
      },
      {
        "question": "Is this included with your other services?",
        "answer": "Basic reporting is included in every plan. A full tracking setup and attribution is a separate project or add-on, agreed in the proposal."
      }
    ]
  }
];

export const CITIES: CityContent[] = [
  {
    "slug": "delhi",
    "metaTitle": "Digital Marketing Agency in Delhi",
    "metaDescription": "SEO, Google and Meta ads, social media, content and websites for Delhi businesses, from a team based in West Delhi. Talk to us.",
    "pages": [
      {
        "serviceSlug": "seo",
        "localIntro": "Delhi buyers search before they step out. Someone in Janakpuri looks up \"skin clinic near me\", a shopper in Karol Bagh checks reviews before visiting a store, and a parent in Mukherjee Nagar compares coaching centres on Google Maps. If your business doesn't appear in those searches, the customer walks into a competitor's door a few streets away. We help Delhi businesses show up where these decisions are made: in Google's local map results, in \"near me\" searches, and in the organic results for the services they sell. As a team based in West Delhi, we know how differently people search across the city, from colony names and market names to Hindi-English mixed queries. We build your SEO around those real searches, not generic keywords nobody types. Every month you see clicks, queries and enquiries from your own Search Console and Google Analytics in your client portal.",
        "marketContext": "Delhi is not one market but dozens of neighbourhood markets. A clinic in Rajouri Garden competes with clinics in Rajouri Garden and Tilak Nagar, not with one in Saket. Wholesale hubs like Chandni Chowk and Sadar Bazaar, electronics markets like Nehru Place, and industrial areas like Okhla and Naraina each have their own search patterns. Many searches name a locality, a metro station or a market rather than the city. That makes Google Business Profile, locality-level pages and consistent business listings especially important here. Competition for broad terms is intense, so we focus on the specific localities and services where your business can realistically win.",
        "industries": [
          "Clinics and healthcare practices",
          "Coaching institutes and education centres",
          "Retail stores and showrooms",
          "Wholesale and trading businesses",
          "Restaurants and cafes",
          "Professional services (CA firms, lawyers, consultants)"
        ],
        "positioning": "Locality-first SEO from a West Delhi team that knows how Delhi actually searches.",
        "ctaHeading": "Want more Delhi customers to find you on Google?",
        "ctaBody": "Tell us your business, your localities and your main services. We will look at how you appear in local searches today and what it would take to improve.",
        "metaTitle": "SEO Services in Delhi | Local SEO Agency",
        "metaDescription": "Local SEO for Delhi businesses: Google Business Profile, locality pages and \"near me\" searches, from a West Delhi team. Talk to us.",
        "faqs": [
          {
            "question": "Can you help my business rank in a specific Delhi locality?",
            "answer": "Yes. Most Delhi searches name a colony, market or metro station. We optimise your Google Business Profile and build pages around the localities you actually serve."
          },
          {
            "question": "I have more than one branch in Delhi. Can each one rank?",
            "answer": "Yes. Each branch needs its own verified Google Business Profile and its own location page. We set up and manage both."
          },
          {
            "question": "Do you optimise for Hindi searches?",
            "answer": "We research the Hindi and Hinglish terms your customers use, and include them where they fit your pages naturally."
          }
        ]
      },
      {
        "serviceSlug": "paid-media",
        "localIntro": "Running Google or Meta ads across all of Delhi is one of the fastest ways to waste a budget. A furniture showroom in Kirti Nagar rarely gets customers from Shahdara, and a dental clinic in Dwarka needs patients within a few kilometres, not across the Yamuna. We build Delhi campaigns around where your customers actually come from. We use radius and pin-code targeting, locality keywords and ad schedules that match when Delhi buyers search and call. Every campaign starts with proper tracking of calls, WhatsApp clicks and form fills, so you know what each enquiry costs. Your budget runs from your own Google Ads and Meta accounts, and you approve every campaign before it goes live. Each month we report what you spent, how many enquiries came in and what each one cost, by locality and campaign.",
        "marketContext": "Delhi is one of the most competitive ad markets in the country. Clinics, coaching institutes, real estate and home services all bid on the same high-intent keywords, so broad, city-wide campaigns get expensive quickly. The advantage goes to advertisers who narrow their targeting. That means specific localities, the exact services people search for, and landing pages that load quickly on mobile data. Many Delhi customers prefer to call or message rather than fill a form, so click-to-call and WhatsApp ads often work well here. Seasonal peaks matter too, such as admission season for education and the festive season for retail. Budgets should be planned around these peaks rather than spread evenly across the year.",
        "industries": [
          "Clinics, dentists and diagnostic centres",
          "Coaching and test-preparation institutes",
          "Real estate and property dealers",
          "Furniture, electronics and retail showrooms",
          "Home services (repairs, interiors, pest control)",
          "Restaurants and cloud kitchens"
        ],
        "positioning": "Google and Meta ads targeted to the Delhi localities your customers actually come from.",
        "ctaHeading": "Spending on ads in Delhi without knowing what works?",
        "ctaBody": "Share your current campaigns or your goals. We will review targeting, tracking and cost per enquiry, and show you where the budget is leaking.",
        "metaTitle": "Google Ads & Meta Ads Agency in Delhi",
        "metaDescription": "Google and Meta ads for Delhi businesses, targeted by locality with call and WhatsApp tracking, run from your own ad account. Talk to us.",
        "faqs": [
          {
            "question": "Can you target ads to specific areas of Delhi?",
            "answer": "Yes. We target by radius, pin code or locality, so your budget reaches people who can actually visit or use your service."
          },
          {
            "question": "Do WhatsApp and call ads work in Delhi?",
            "answer": "For many local businesses, yes. We set them up with tracking so you can compare their cost per enquiry against form leads."
          },
          {
            "question": "When should I increase my ad budget?",
            "answer": "Only once tracking shows a steady cost per enquiry. We also plan for your seasonal peaks, such as admissions or the festive season."
          }
        ]
      },
      {
        "serviceSlug": "social-media",
        "localIntro": "Delhi lives on Instagram and WhatsApp. People discover new cafes in Hauz Khas, boutiques in Shahpur Jat and salons in Rajouri Garden through Reels, local pages and stories, long before they visit. For a Delhi business, social media is often the first impression and the place where trust is built. We plan and create content that speaks to Delhi audiences: the festivals they celebrate, the neighbourhoods they know and the way they actually talk online. Every post is designed for your brand, approved by you in your client portal and published on schedule. That frees you to run your business instead of chasing the next post. Each month you also get a short report from the platforms' own insights, showing which posts reached people and started conversations, and what we will change next month.",
        "marketContext": "The festive calendar drives Delhi's social media year. Diwali, Karva Chauth, Holi, Lohri, the wedding season and big sale weekends bring sharp peaks in attention and competition for it. Content that feels local and timely, in a natural mix of Hindi and English, usually outperforms generic posts. Instagram Reels and Google Business Profile posts help local discovery, while LinkedIn matters more for Delhi's professional services and B2B firms. Customers here also expect quick replies to comments and DMs, so response time is part of your brand too. Weddings in particular run for months in Delhi, so jewellers, boutiques, caterers and venues need a content plan that covers the whole season, not just one festival week.",
        "industries": [
          "Cafes, restaurants and bakeries",
          "Fashion boutiques and ethnic wear stores",
          "Salons, spas and wellness studios",
          "Jewellers and wedding services",
          "Clinics and fitness studios",
          "Coaching institutes"
        ],
        "positioning": "Social content made for Delhi's festivals, neighbourhoods and Hinglish conversations, with your approval on every post.",
        "ctaHeading": "Want your Delhi audience to notice you before the next festive season?",
        "ctaBody": "Tell us about your brand and which platforms matter to you. We will share a sample monthly plan built around Delhi's calendar.",
        "metaTitle": "Social Media Marketing Agency in Delhi",
        "metaDescription": "Instagram, Facebook and LinkedIn content for Delhi brands, planned around local festivals and approved by you before it goes live. Talk to us.",
        "faqs": [
          {
            "question": "Do you plan content around Delhi festivals and the wedding season?",
            "answer": "Yes. We build the monthly calendar around the occasions your Delhi audience celebrates, and plan festive campaigns weeks ahead."
          },
          {
            "question": "Can posts be in Hindi or Hinglish?",
            "answer": "Yes, if that suits your audience. We agree the language mix and tone of voice with you at the start."
          },
          {
            "question": "Can you shoot photos and videos at our Delhi location?",
            "answer": "Tell us what you need in the brief. On-site shoots can be added to your plan and are confirmed in the proposal."
          }
        ]
      },
      {
        "serviceSlug": "content-marketing",
        "localIntro": "When someone in Delhi searches \"best physiotherapist in Pitampura\" or \"how to choose a CA firm in Delhi\", Google rewards the business that answers the question clearly. Generic content copied across a hundred cities doesn't do that. We write content for Delhi businesses that reflects how your customers think and search: the localities they live in, the questions they ask before buying, and the comparisons they make. Our team in West Delhi researches each topic, writes in your brand's voice and fact-checks every detail. Every piece comes to your client portal for approval. The result is a library of blogs, guides and pages that keeps bringing Delhi customers to your website long after it is published. We also refresh older pieces when facts, prices or rules change, so your content stays accurate.",
        "marketContext": "Most Delhi businesses compete on the same handful of pages: a home page, a services page and a contact form. Very few answer the detailed questions customers ask before they enquire. That gap is an opportunity. A clinic that explains treatment options clearly, a coaching institute that publishes honest exam guidance, or a property consultant who writes about specific Delhi localities builds trust before the first call. Delhi audiences also read in both English and Hindi, so the right language mix depends on your customers. Locality guides and comparison articles tend to attract searchers who are close to a decision. Content that answers fee, timing and eligibility questions honestly also reduces repetitive calls to your team.",
        "industries": [
          "Healthcare and wellness clinics",
          "Coaching institutes and education consultants",
          "Property consultants and builders",
          "CA firms, legal and financial advisers",
          "Interior designers and architects",
          "Travel agencies and tour operators"
        ],
        "positioning": "Content that answers the questions Delhi customers ask before they buy, researched and written by people, not templates.",
        "ctaHeading": "Want your website to answer what Delhi customers are searching for?",
        "ctaBody": "Tell us your services and audience. We will suggest the first ten topics your Delhi customers are already searching for.",
        "metaTitle": "Content Writing & Content Marketing in Delhi",
        "metaDescription": "Blogs, locality guides and website copy for Delhi businesses, researched and written by people and approved by you. Talk to us.",
        "faqs": [
          {
            "question": "Can you write content about specific Delhi localities?",
            "answer": "Yes. Locality guides and area pages work well for clinics, property, education and home services. We write them only where we can add genuinely useful local detail."
          },
          {
            "question": "Do you write content in Hindi?",
            "answer": "Tell us your audience. We can plan content in English, Hindi or both, and confirm it in the proposal."
          },
          {
            "question": "How often should a Delhi business publish new content?",
            "answer": "Consistency matters more than volume. For most businesses, two to four well-researched pieces a month is a good start."
          }
        ]
      },
      {
        "serviceSlug": "web-design-development",
        "localIntro": "For many Delhi customers, your website is the step between a Google search and a phone call. If it loads slowly on mobile data, hides your address, or makes it hard to call or message, the enquiry goes elsewhere. We design and build websites for Delhi businesses that make the next step obvious. That means a clear tap-to-call and WhatsApp button, your Google Maps location, your timings and the localities you serve. Every site is mobile-first, fast, SEO-ready and comes with a content management system your team can update. We are based in West Delhi, so meetings, content shoots and reviews can happen in person if you prefer. After launch, we stay available for updates, fixes and new pages, so the site keeps up with your business.",
        "marketContext": "A large share of Delhi's small and mid-sized businesses still rely on outdated websites or just a social media page. That makes a fast, well-structured site a real advantage. Delhi customers usually browse on their phones, often on the move, so speed and mobile layout decide whether they stay. Businesses with several branches across the city need a separate location page for each, with its own address and map, to show up in local searches. Trust signals matter too: a real address, GST details where relevant, genuine reviews and clear policies help a new visitor decide to call. For exporters and manufacturers in areas like Okhla, Naraina and Bawana, a clear product catalogue and enquiry form often matter more than flashy design.",
        "industries": [
          "Clinics and diagnostic labs",
          "Schools, colleges and coaching institutes",
          "Manufacturers and exporters in Delhi's industrial areas",
          "Retailers and showrooms",
          "Hotels, banquet halls and restaurants",
          "Professional and financial services"
        ],
        "positioning": "Fast, mobile-first websites for Delhi businesses, built by a West Delhi team you can meet in person.",
        "ctaHeading": "Is your website losing Delhi customers on mobile?",
        "ctaBody": "Send us your current website or tell us what you need. We will review speed, mobile layout and enquiry flow, and suggest what to fix first.",
        "metaTitle": "Website Design Company in Delhi",
        "metaDescription": "Mobile-first business websites for Delhi companies: fast, SEO-ready, with tap-to-call, WhatsApp and location pages. Built in West Delhi. Talk to us.",
        "faqs": [
          {
            "question": "Can we meet in person to discuss the website?",
            "answer": "Yes. We are based in West Delhi and can meet at your office or ours, by appointment."
          },
          {
            "question": "We have several branches in Delhi. How should the website handle them?",
            "answer": "Each branch gets its own location page with address, map, timings and contact details. This helps each branch appear in local searches."
          },
          {
            "question": "Can you build a website in Hindi as well as English?",
            "answer": "Yes. We can build a bilingual site, and agree the scope in the proposal."
          }
        ]
      },
      {
        "serviceSlug": "marketing-analytics",
        "localIntro": "Many Delhi business owners know their marketing spend to the rupee but not which channel actually brought in customers. Was it the Google ad, the Instagram post, the listing on a directory, or a referral from a regular customer? Without tracking, every decision about budget is a guess. We set up analytics that follow each enquiry back to its source. That covers form fills on your website, calls from Google, WhatsApp chats and visits from your Google Business Profile. Everything runs on your own Google Analytics, Search Console, Google Ads and Meta accounts. You see the results in plain language in your client portal, with a monthly review of what to change. No vanity numbers: every figure in your report comes from an account you own and can check yourself.",
        "marketContext": "In Delhi, a large share of enquiries arrive by phone call or WhatsApp rather than a website form. Customers also mix channels: they see an Instagram post, search on Google Maps, then call. Standard analytics setups miss most of this. Good tracking for a Delhi business means call tracking, WhatsApp click tracking, Google Business Profile insights and consistent UTM tags on every campaign link. For businesses with several outlets across the city, it also means seeing which locations and localities bring the most enquiries. With this in place, you can confidently move budget towards the channels that work. Directory listings and offline referrals can also be tagged, so word-of-mouth enquiries are counted instead of disappearing from the picture.",
        "industries": [
          "Multi-branch clinics and diagnostic chains",
          "Retail chains and showrooms",
          "Coaching institutes with several centres",
          "Real estate developers and brokers",
          "D2C brands selling online from Delhi",
          "B2B suppliers and distributors"
        ],
        "positioning": "Tracking that follows every Delhi enquiry, call and WhatsApp chat back to the channel that earned it.",
        "ctaHeading": "Not sure which of your marketing channels brings Delhi customers?",
        "ctaBody": "Tell us how enquiries reach you today. We will review your tracking setup and show you what is being missed.",
        "metaTitle": "Marketing Analytics & GA4 Setup in Delhi",
        "metaDescription": "GA4, call, WhatsApp and UTM tracking for Delhi businesses, so you know which channels bring enquiries. Reports from your own accounts.",
        "faqs": [
          {
            "question": "Can you track phone calls and WhatsApp enquiries?",
            "answer": "Yes. We track clicks on your call and WhatsApp buttons, and calls from Google ads and your Google Business Profile."
          },
          {
            "question": "We have outlets in different parts of Delhi. Can we compare them?",
            "answer": "Yes. With separate location pages and tagged links, your reports can show enquiries by outlet and locality."
          },
          {
            "question": "Do I need to share my account passwords?",
            "answer": "No. You grant us access to your Google and Meta accounts through their official user management, and you can remove it any time."
          }
        ]
      }
    ]
  },
  {
    "slug": "gurgaon",
    "metaTitle": "Digital Marketing Agency in Gurgaon (Gurugram)",
    "metaDescription": "SEO, ads, social media, content and websites for Gurgaon startups, corporates and local businesses, from a Delhi NCR team. Talk to us.",
    "pages": [
      {
        "serviceSlug": "seo",
        "localIntro": "Gurgaon has some of the most digitally savvy buyers in India, and they expect to find a business on Google within seconds. A corporate team in Cyber City searching for an event venue, a family on Golf Course Road looking for a paediatrician, and a startup founder comparing coworking spaces on Sohna Road all start with a search. We help Gurgaon businesses rank for those searches with technical SEO, well-structured service pages and a strong Google Business Profile. Gurgaon is also searched as Gurugram, by sector number and by landmarks such as Cyber Hub or MG Road. We make sure your pages and listings cover the names your customers actually use. Every month you see the progress in your client portal, with clicks, queries and enquiries pulled from your own Search Console and Google Analytics.",
        "marketContext": "Gurgaon's search landscape is shaped by its sectors. Many searches name a sector number, a society or a corporate hub instead of a broad area. New residential zones along Dwarka Expressway and in New Gurugram keep adding demand for clinics, schools, salons and home services, often before many local businesses have built an online presence there. At the same time, B2B, real estate and SaaS companies headquartered in the city compete for national keywords. A good Gurgaon SEO plan separates the two: sector-level local visibility for walk-in businesses, and content-led authority for companies selling across India. Mixing them on the same pages usually serves neither audience well, so we plan separate pages and keywords for each.",
        "industries": [
          "Real estate developers and channel partners",
          "B2B SaaS and technology companies",
          "Clinics, dental and specialist practices",
          "Schools, preschools and coaching centres",
          "Coworking and serviced office spaces",
          "Restaurants and premium retail"
        ],
        "positioning": "Sector-level local SEO for Gurgaon businesses, and national SEO for the companies headquartered here.",
        "ctaHeading": "Are Gurgaon customers finding your competitors first?",
        "ctaBody": "Tell us your sectors, services and goals. We will check how you appear for the searches that matter in Gurgaon and where the quick wins are.",
        "metaTitle": "SEO Company in Gurgaon (Gurugram)",
        "metaDescription": "SEO for Gurgaon businesses: sector-level local search, Google Business Profile and content for companies selling across India. Talk to us.",
        "faqs": [
          {
            "question": "Should my pages say Gurgaon or Gurugram?",
            "answer": "Both. People search with both names, so we use them naturally across your pages and listings."
          },
          {
            "question": "Can you help a new business in a fast-growing sector rank locally?",
            "answer": "Yes. Newer sectors often have less online competition, so a well-set-up Google Business Profile and a location page can win visibility quickly."
          },
          {
            "question": "We sell across India but are based in Gurgaon. Is local SEO still useful?",
            "answer": "Yes, for your brand and office searches. Most of the growth, though, will come from national, content-led SEO, which we plan separately."
          }
        ]
      },
      {
        "serviceSlug": "paid-media",
        "localIntro": "Gurgaon's audience splits in two: professionals working in its corporate hubs, and the families living in its sectors and gated societies. They search, scroll and buy at different times and for different reasons. We run Google and Meta campaigns that reflect that split. B2B and lead-generation campaigns reach decision-makers during working hours. Consumer campaigns for clinics, schools, restaurants and home services reach residents in the sectors you serve. For real estate and high-ticket services, we build lead forms with qualifying questions, so your sales team spends its time on serious buyers. Campaigns run from your own ad accounts, and you approve every launch and budget change. Monthly reports show spend, leads, qualified leads and cost per qualified lead, so you can judge the campaigns on the outcome your sales team actually cares about.",
        "marketContext": "Gurgaon has a high share of affluent, English-first, mobile-heavy users, which makes it attractive to advertisers and expensive to compete in. Real estate is one of the heaviest ad spenders in the city, with project launches along Dwarka Expressway, Golf Course Extension Road and New Gurugram pushing up costs for property keywords. B2B companies here often target national audiences, where LinkedIn and Google Search work better than broad Meta campaigns. Lead quality is usually the real problem, not lead volume. Qualifying questions, call verification and a quick sales follow-up matter as much as the ads themselves. A lead that is called back quickly is more likely to remember the enquiry, so we set up instant lead alerts for your sales team.",
        "industries": [
          "Real estate projects and channel partners",
          "B2B SaaS and IT services",
          "Premium clinics and hospitals",
          "International schools and preschools",
          "Restaurants, bars and cafes in Sector 29 and Cyber Hub",
          "Interior design and home improvement"
        ],
        "positioning": "Ad campaigns built for lead quality, not just lead volume, in one of NCR's most competitive markets.",
        "ctaHeading": "Getting plenty of Gurgaon leads, but too few real buyers?",
        "ctaBody": "Share your current campaigns and lead quality. We will review targeting, forms and follow-up, and suggest how to get more serious enquiries for the same budget.",
        "metaTitle": "PPC & Paid Ads Agency in Gurgaon (Gurugram)",
        "metaDescription": "Google, Meta and LinkedIn ads for Gurgaon real estate, B2B and premium local businesses, built for qualified leads, not just clicks.",
        "faqs": [
          {
            "question": "Do you run real estate ads in Gurgaon?",
            "answer": "Yes. We follow Google and Meta's housing ad policies, and use qualifying lead forms so your team can focus on serious buyers."
          },
          {
            "question": "Can you run LinkedIn ads for B2B companies in Gurgaon?",
            "answer": "Yes. For many B2B companies, LinkedIn and Google Search work better than broad social ads. We recommend the mix in your proposal."
          },
          {
            "question": "How do you improve lead quality?",
            "answer": "We add qualifying questions to forms, track which campaigns produce sales-ready leads, and move budget towards them."
          }
        ]
      },
      {
        "serviceSlug": "social-media",
        "localIntro": "Gurgaon audiences are quick to follow a brand and just as quick to scroll past one that looks generic. A cafe in Sector 29, a fitness studio on Golf Course Road or a D2C brand run from Udyog Vihar competes for attention with national brands in the same feed. We create social content for Gurgaon businesses that looks polished and stays consistent. Every post is designed for your brand, written for your audience and approved by you in your client portal before it goes live. For B2B and corporate brands headquartered in Gurgaon, we also build LinkedIn presence for the company and its leadership, where many of your future clients and hires spend their time. You see the full monthly calendar in advance, and nothing is posted without your approval.",
        "marketContext": "Gurgaon is one of the most English-first and Instagram-active audiences in NCR, with a large community of young professionals and families in gated societies. Society WhatsApp groups and resident communities strongly shape local word of mouth, so a good experience gets shared quickly. LinkedIn matters more here than in most cities, because of the concentration of corporate offices, startups and recruiters. Weekend dining, events and lifestyle content perform well on Instagram. B2B brands get more from thought leadership and employer branding. Visual quality expectations are high, so design consistency is not optional. Brands that post sporadically or mix styles quickly look neglected next to competitors with a steady, recognisable feed, which is why we plan the whole month in advance.",
        "industries": [
          "Cafes, bars and fine dining",
          "Fitness studios, gyms and wellness brands",
          "D2C and lifestyle brands",
          "Startups and B2B companies (LinkedIn)",
          "Real estate projects",
          "Salons, aesthetics and skin clinics"
        ],
        "positioning": "Polished, consistent social content for Gurgaon's lifestyle brands, and LinkedIn presence for its corporates and startups.",
        "ctaHeading": "Want a social presence that matches your Gurgaon brand?",
        "ctaBody": "Tell us which platforms matter and who you want to reach. We will share a sample month of content ideas for your brand.",
        "metaTitle": "Social Media Agency in Gurgaon (Gurugram)",
        "metaDescription": "Instagram content for Gurgaon lifestyle brands and LinkedIn for its startups and corporates, designed for your brand and approved by you.",
        "faqs": [
          {
            "question": "Do you manage LinkedIn for companies and founders?",
            "answer": "Yes. We plan company page content and can support leadership profiles, with every post approved before it goes out."
          },
          {
            "question": "Can you cover events and launches at our Gurgaon venue?",
            "answer": "Event coverage can be added to your plan. Tell us your calendar, and we will confirm it in the proposal."
          },
          {
            "question": "How do you keep our feed consistent?",
            "answer": "We agree brand templates, colours and tone at the start, and every post follows them."
          }
        ]
      },
      {
        "serviceSlug": "content-marketing",
        "localIntro": "Many of Gurgaon's businesses sell to other businesses, to buyers across India, or to customers who research carefully before spending. That makes content one of the most valuable things they can own. A SaaS company needs articles that explain the problem it solves. A real estate developer needs honest project and location guides. A specialist clinic needs clear answers to patients' questions. We plan and write that content for Gurgaon companies: blogs, guides, case-study write-ups from your own projects, LinkedIn articles and website copy. Every piece is researched, written in your voice and approved by you in the client portal before it is published. We track which pieces bring visitors, sign-ups and enquiries, and use that data to plan the next month's topics.",
        "marketContext": "Gurgaon's audience is highly educated and quick to spot generic, AI-sounding copy. Content that works here is specific, well researched and written for a reader who is comparing options. B2B companies headquartered in the city often compete for national search terms, so long-form guides and thought leadership matter more than local keywords. For consumer businesses, sector and society-level guides help, for example a school comparison for a sector cluster or a guide to a new residential corridor. LinkedIn articles and newsletters also reach Gurgaon's large professional audience directly. For real estate, content must also stay accurate on RERA numbers, possession timelines and approvals, so every claim is checked against official project documents before it goes live.",
        "industries": [
          "B2B SaaS and technology companies",
          "Real estate developers and consultants",
          "Consulting and professional services firms",
          "Specialist healthcare and hospitals",
          "Education providers and edtech",
          "Hospitality and premium lifestyle brands"
        ],
        "positioning": "Researched, specific content for Gurgaon companies whose buyers read carefully before they decide.",
        "ctaHeading": "Need content that Gurgaon's decision-makers actually read?",
        "ctaBody": "Tell us your audience and what you sell. We will propose a content plan built around the questions your buyers are already asking.",
        "metaTitle": "Content Marketing Agency in Gurgaon (Gurugram)",
        "metaDescription": "Blogs, guides, LinkedIn articles and website copy for Gurgaon B2B, real estate and healthcare brands, researched and written by people.",
        "faqs": [
          {
            "question": "Do you write B2B and technical content?",
            "answer": "Yes. We interview your team or subject experts, so technical content is accurate and sounds like you."
          },
          {
            "question": "Can you write LinkedIn articles for our founders?",
            "answer": "Yes. We draft from short interviews, and nothing is posted without the founder's approval."
          },
          {
            "question": "Is your content written by AI?",
            "answer": "AI tools may help with research and first drafts, but every piece is written, fact-checked and edited by a person."
          }
        ]
      },
      {
        "serviceSlug": "web-design-development",
        "localIntro": "In Gurgaon, your website is often judged alongside global brands. A visitor who works at a multinational in Cyber City, or a buyer comparing premium apartments, will notice a slow page or a dated design within seconds. We build websites for Gurgaon businesses that look current, load fast and make the next step clear, whether that is booking a demo, scheduling a site visit or reserving a table. Every site is mobile-first, SEO-ready and comes with a content management system your team can update. For SaaS and B2B companies, we also build product pages, pricing pages and demo-booking flows connected to your CRM. You review everything on a staging link before launch, and after launch your team can edit pages, add posts and publish updates without waiting on a developer.",
        "marketContext": "Gurgaon's buyers set a high bar for digital experience. They use well-designed apps and websites every day, so a clunky enquiry form or a page that breaks on mobile costs credibility immediately. Real estate projects need fast-loading microsites with floor plans, location maps and RERA details. Startups need sites they can update weekly as they ship and hire. Restaurants and clinics need simple booking and clear location information. Across all of these, page speed, clean design and accessible layouts help both visitors and search rankings. Many visitors also arrive from LinkedIn, ads or a WhatsApp link shared in a society group, so every landing page has to work on its own, on any phone, without relying on the home page to explain who you are.",
        "industries": [
          "SaaS and technology startups",
          "Real estate project microsites",
          "Corporate and consulting firms",
          "Hospitals, clinics and diagnostics",
          "Restaurants, cafes and hospitality",
          "Schools and edtech"
        ],
        "positioning": "Websites that hold their own against global brands, built for Gurgaon companies that are judged on first impressions.",
        "ctaHeading": "Does your website match the standard Gurgaon buyers expect?",
        "ctaBody": "Share your current site or your plans. We will review design, speed and conversion, and suggest the changes that would matter most.",
        "metaTitle": "Website Development Company in Gurgaon (Gurugram)",
        "metaDescription": "Fast, modern websites for Gurgaon startups, real estate projects and corporates, with booking and demo flows. SEO-ready from day one.",
        "faqs": [
          {
            "question": "Do you build real estate project microsites?",
            "answer": "Yes, with floor plans, location maps, RERA details and lead forms connected to your sales team."
          },
          {
            "question": "Can you build demo-booking and CRM integrations for SaaS companies?",
            "answer": "Yes. We connect forms and booking tools to your CRM, and agree the integrations in the proposal."
          },
          {
            "question": "How fast will the website be?",
            "answer": "We build for speed from the start and test on mobile networks before launch. Results depend on your content and integrations, and we report the scores to you."
          }
        ]
      },
      {
        "serviceSlug": "marketing-analytics",
        "localIntro": "Gurgaon companies often run several channels at once: Google and LinkedIn ads, SEO, social media, events and sales outreach. Without clean tracking, it is impossible to say which of them brought in a customer, and budgets get set by opinion. We set up analytics that connect marketing activity to real outcomes. That covers GA4 conversion events, UTM standards across every campaign, CRM integration so leads can be followed to closed deals, and dashboards your leadership team can read in a minute. Everything runs on your own Google, LinkedIn and Meta accounts. The insights come to you in plain language through your client portal. We agree the handful of numbers that matter at the start, such as qualified leads, cost per qualified lead and pipeline by channel, so reports stay focused on decisions rather than vanity metrics.",
        "marketContext": "B2B and real estate sales cycles in Gurgaon can run for weeks or months, and a lead often touches several channels before it converts. Last-click reporting gives most of the credit to whatever happened last, usually a brand search, and hides what really started the conversation. Better attribution needs consistent UTM tags, offline conversions imported from your CRM, and agreed definitions of a qualified lead. Funded startups and corporate teams here also report to investors or management, so dashboards need to be accurate, simple and built on data they can trust. Privacy matters too: tracking should respect cookie consent and India's Digital Personal Data Protection Act, so the numbers you rely on are also collected the right way.",
        "industries": [
          "B2B SaaS and IT services",
          "Real estate developers and brokers",
          "Funded startups and D2C brands",
          "Hospitals and healthcare networks",
          "Education and edtech companies",
          "Financial services and fintech"
        ],
        "positioning": "Attribution and dashboards that connect Gurgaon companies' marketing spend to qualified leads and closed deals.",
        "ctaHeading": "Can you tell which channel brought your last ten Gurgaon customers?",
        "ctaBody": "Tell us your channels, CRM and sales process. We will review your tracking and show you where attribution is breaking down.",
        "metaTitle": "Marketing Analytics & Attribution in Gurgaon",
        "metaDescription": "GA4, UTM, CRM and offline conversion tracking for Gurgaon B2B, real estate and startups, with dashboards your leadership can trust.",
        "faqs": [
          {
            "question": "Can you connect our CRM to Google Ads and GA4?",
            "answer": "Yes. Importing qualified leads and closed deals back into your ad accounts helps optimise for real outcomes, not just form fills."
          },
          {
            "question": "We have a long sales cycle. Can you still show which channel worked?",
            "answer": "Yes, with consistent UTM tagging and CRM integration we can report first touch, last touch and assisted conversions."
          },
          {
            "question": "Will the dashboards work for our investors or management?",
            "answer": "Yes. We build simple dashboards on your own data, with agreed definitions so everyone reads the numbers the same way."
          }
        ]
      }
    ]
  }
];
