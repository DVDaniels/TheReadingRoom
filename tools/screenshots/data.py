"""Made-up writers and posts for App Store screenshots. Every person, site and post here is invented."""
from datetime import datetime, timedelta, timezone

NOW = datetime.now(timezone.utc).replace(microsecond=0)
def ago(h): return (NOW - timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ')

PEOPLE = [  # id, name, host, recent posts in 30 days
    (1, 'Sarah Mitchell', 'sarahmitchell.net'),
    (2, 'Jake Turner', 'jaketurner.ink'),
    (3, 'Emily Carter', 'emilycarter.blog'),
    (4, 'Mike Sullivan', 'mikesullivan.org'),
    (5, 'Linda Russo', 'lindarusso.com'),
    (6, 'Ben Harlow', 'benharlow.net'),
    (7, 'Jessica Brooks', 'jessicabrooks.me'),
    (8, 'Amy Parker', 'amyparker.co'),
    (9, 'Kevin Chen', 'kevinchen.dev'),
    (10, 'Maria Lopez', 'marialopez.org'),
]
FOLDERS = [
    {'id': 1, 'name': 'Friends', 'parent_id': None, 'position': 0},
    {'id': 2, 'name': 'Web & Design', 'parent_id': None, 'position': 1},
    {'id': 3, 'name': 'Food & Gardens', 'parent_id': None, 'position': 2},
]
FOLDER_OF = {1: 3, 2: 2, 3: 1, 4: 1, 5: 3, 6: 2, 7: 1, 8: 1, 9: 2, 10: 3}

def feed(i, name, host):
    return {'id': i, 'url': f'https://{host}/feed/', 'title': name, 'site': f'https://{host}/', 'status': 'ok', 'error': '',
            'last_fetched': ago(0.3), 'folder_id': FOLDER_OF[i], 'recent': 6, 'latest': ago(1)}

FEEDS = [feed(*p) for p in PEOPLE]

def P(pid): return next(p for p in PEOPLE if p[0] == pid)
def url(pid, slug): return f'https://{P(pid)[2]}/{slug}/'

ITEMS = []
def post(pid, slug, title, hours, summary, image='', links=(), read=False, tags='', comments=-1):
    ITEMS.append({'id': f'{pid}-{slug}', 'feed_id': pid, 'title': title, 'link': url(pid, slug), 'date': ago(hours),
                  'summary': summary, 'image': image, 'audio': '', 'shares': '', 'read': read, 'saved': False,
                  'read_at': None, 'byline': P(pid)[1], 'paid': False, 'links': ' '.join(links), 'comments': comments, 'tags': tags})

PIC = 'https://pics.test/'
# A conversation: Ben's post, answered by Emily and Jake
post(6, 'keep-a-blogroll', 'Why I still keep a blogroll', 9,
     "Every few months someone asks why my site still has a list of other people's blogs on it, like it's 2004. The honest answer: it's the best way I know to send someone somewhere good. No algorithm picked these people. I did, because I read them.",
     tags='indieweb\tblogging', comments=4)
post(3, 'my-blogroll-is-a-bookshelf', 'My blogroll is a bookshelf', 6,
     "Ben Harlow wrote this morning about why he keeps a blogroll. Mine works like the shelf by my front door: the books I'd hand you on your way out. Half the writers I love, I found on someone else's list.",
     links=(url(6, 'keep-a-blogroll'),), tags='blogging')
post(2, 'blogrolls-are-links', 'Blogrolls are just links, and links are the web', 3,
     "Agreeing with Ben and Emily here. A link from one person to another is the oldest recommendation engine we have, and it still works better than any feed I've been shown.",
     links=(url(6, 'keep-a-blogroll'), url(3, 'my-blogroll-is-a-bookshelf')), tags='indieweb')
# Posts with pictures
post(1, 'first-tomatoes', 'The first tomatoes of the fall garden', 2,
     "Three weeks late and smaller than last year, but the Cherokee Purples came in this week. I ate the first one standing in the garden with a little salt, which is the only correct way.",
     image=PIC + 'tomatoes.jpg', tags='garden')
post(4, 'fog-walk', 'A walk in the fog', 4,
     "The river path at 7 am, before anyone else was up. The fog made the whole town look like a pencil drawing. I took forty pictures and kept these.",
     image=PIC + 'fog.jpg', tags='photography\twalks')
post(5, 'sunday-soup', 'Sunday soup, the one my grandmother made', 12,
     "Every family has a soup that fixes things. Ours has white beans, a parmesan rind and far too much garlic. Here's how she made it, as close as I can remember.",
     image=PIC + 'soup.jpg', tags='recipes', comments=7)
# Short notes
post(7, 'note-1105', '', 1.2,
     "Finished my first zine today. Twelve pages, hand-stapled, about the bus routes in my city. If you want one, write to me and I'll mail it.", tags='zines')
post(8, 'note-library', '', 5,
     "The library put out a table of free seeds for next spring. I came home with peppers, zinnias and something labelled only 'mystery squash'.")
post(9, 'small-sites', 'Small sites load fast', 7,
     "My whole site is 41 KB. It loads before you finish blinking. I'm not saying yours has to be that small, but I am saying you should try opening it on a slow phone.",
     tags='webdev')
post(10, 'back-to-writing', 'I’m back to writing here', 10,
     "It's been a while. I spent most of the year posting on apps that don't exist anymore, and none of it is anywhere now. This site is still here. So am I.",
     tags='blogging')
post(1, 'compost', 'What I learned from a year of compost', 30, "Mostly that it's slower than the books say, and that the worms are smarter than me.", read=True)
post(2, 'css-has', 'Five things I use :has() for every day', 34, "A short list of small, boring, very useful tricks.", read=True, tags='css')
post(3, 'october-reading', 'Everything I read in October', 40, "Eleven books, two of them great, one of them I'll be thinking about for years.", read=True, tags='books')
post(4, 'harbor', 'The harbor at dusk', 52, "Same spot, twelve evenings in a row.", image=PIC + 'harbor.jpg', read=True)
post(6, 'webmention', 'Replies between blogs, explained simply', 60, "When I link to your post, your site can find out. That's all a webmention is.", read=True)
# An earlier post from Rosa, months ago, so her new one says "Back after"
post(10, 'old-post', 'Notes from the spring', 24 * 140, "A few things from the garden.", read=True)

STATE = {'folders': FOLDERS, 'feeds': FEEDS, 'items': ITEMS, 'highlights': [], 'mutes': [], 'lists': [],
         'prefs': {'mine': 'none', 'friends': [FEEDS[2]['url'], FEEDS[0]['url']]}, 'refreshing': False, 'lastRefresh': ago(0.3)}

ARTICLE = """<p>Every few months someone asks why my site still has a list of other people's blogs on it, like it's 2004. The honest answer: it's the best way I know to send someone somewhere good.</p>
<p>No algorithm picked these people. I did, because I read them. Some of them I've read for fifteen years. A couple I found last month, on somebody else's list, which is exactly how this is supposed to work.</p>
<h2>A list is a recommendation</h2>
<p>When I link to you, I'm saying: this person is worth your time. That's a small thing, but small things add up. A web made of people pointing at people is a web you can actually walk around in.</p>
<p>The big platforms taught us to wait for something to be shown to us. A blogroll is the opposite. It's a door you open on purpose.</p>
<h2>How to start one</h2>
<p>Write down five sites you read and like. Put them on a page. That's it. You can add a sentence about each one if you want, but you don't have to.</p>
<p>Then go read someone else's list, and follow one person you didn't know yesterday.</p>"""
STATE['highlights'] = [{'id': 1, 'item_id': '6-keep-a-blogroll', 'text': "A web made of people pointing at people is a web you can actually walk around in.",
                        'note': 'Putting this on the front of my own blogroll page.', 'start': 0, 'created_at': ago(1)}]
PLINKS = {f"https://{p[2]}/": {'at': 9e12, 'links': [], 'icon': PIC + f"face-{p[0]}.jpg", 'about': a} for p, a in zip(PEOPLE, [
    'Gardener and neighborhood organizer. Writes about tomatoes, compost and the people on her street.',
    'Web developer. Small sites, plain HTML and CSS that works everywhere.',
    'Reader, librarian, list-maker. Every book I finish, written up here.',
    'Photographs of a small river town, one walk at a time.',
    'Home cooking and family recipes, written down before they get lost.',
    'Writing about the independent web since 2006.',
    'Zines, buses and city maps.', 'Seeds, libraries and slow weekends.', 'Fast, tiny websites.', 'Back to blogging, for good this time.'])}

# Writing (1.2.9): a made-up site of the made-up reader, Alex Moreno. WordPress gives dates in UTC without the Z.
def wp(h): return (NOW - timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%S')
CATS = [{'id': 7, 'slug': 'notes', 'name': 'Notes', 'count': 48}, {'id': 8, 'slug': 'weeknotes', 'name': 'Weeknotes', 'count': 21},
        {'id': 3, 'slug': 'garden', 'name': 'Garden', 'count': 14}, {'id': 4, 'slug': 'reading', 'name': 'Reading', 'count': 22},
        {'id': 5, 'slug': 'the-web', 'name': 'The web', 'count': 17}, {'id': 1, 'slug': 'uncategorized', 'name': 'Uncategorized', 'count': 0}]
def wpost(i, title, hours, cats, excerpt='', status='publish', slug='x'):
    return {'id': i, 'title': title, 'excerpt': excerpt, 'date': wp(hours), 'modified': wp(hours), 'categories': cats, 'status': status,
            'link': f'https://alexmoreno.net/{slug}/', 'image': ''}
SITE = {
    'accounts': {'wordpress': {'site': 'https://alexmoreno.net', 'name': 'Alex Moreno'}, 'bluesky': {'handle': 'alexmoreno.net'}, 'mastodon': {'handle': '@alex@social.example'}},
    'draft': [wpost(301, 'A year of walking to the library', 26, [4], status='draft'), wpost(302, 'Small sites I keep coming back to', 75, [5], status='draft'),
               wpost(303, 'The bean soup, my way', 140, [3], status='draft')],
    'publish': [wpost(290, 'Finally planted the garlic. Forty cloves, one row, see you in July.', 20, [7], excerpt='Finally planted the garlic. Forty cloves, one row, see you in July.'),
                wpost(289, 'Weeknotes: rain, soup and a new shelf', 30, [8]),
                wpost(288, 'Ben’s post got me to start a blogroll. Five people so far.', 50, [7], excerpt='Ben’s post got me to start a blogroll. Five people so far.'),
                wpost(287, 'Everything I read in October', 98, [4]),
                wpost(286, 'Why my site has no comments, and how to reach me anyway', 170, [5]),
                wpost(285, 'Weeknotes: the first frost', 200, [8]),
                wpost(284, 'Saving seeds from the Cherokee Purples', 260, [3]),
                wpost(283, 'A short note on long walks', 320, [7], excerpt='A short note on long walks')],
    'future': [wpost(320, 'Five things I learned from a year of Weeknotes', -60, [8], status='future')],
    'stats': {'site': 'alexmoreno.net', 'at': int((NOW - timedelta(minutes=20)).timestamp() * 1000),
              'visitors': {'total': 1840, 'prev': 1512, 'window': 28, 'label': 'visits', 'source': 'From The Reading Room stats',
                           'through': (NOW - timedelta(days=1)).strftime('%Y-%m-%d'),
                           'days': [{'d': (NOW - timedelta(days=28 - i)).strftime('%Y-%m-%d'), 'n': n} for i, n in enumerate(
                               [52, 48, 61, 55, 49, 40, 44, 58, 63, 71, 66, 60, 47, 45, 59, 62, 140, 96, 70, 64, 51, 49, 57, 66, 73, 68, 61, 79])]},
              'rss': {'total': 312, 'prev': 301, 'apps': [{'name': 'The Reading Room', 'n': 96}, {'name': 'NetNewsWire', 'n': 71}, {'name': 'Feedly', 'n': 58}, {'name': 'Inoreader', 'n': 41}]},
              'top': [{'title': 'Everything I read in October', 'url': 'https://alexmoreno.net/x/', 'n': 286}, {'title': 'Saving seeds from the Cherokee Purples', 'url': 'https://alexmoreno.net/x/', 'n': 205},
                      {'title': 'Why my site has no comments', 'url': 'https://alexmoreno.net/x/', 'n': 160}]},
}
IDEAS = [{'id': 'i1', 't': 'What my grandmother’s recipe cards taught me about blogging', 'at': ago(30)},
         {'id': 'i2', 't': 'A walking map of every little free library in town', 'at': ago(80)},
         {'id': 'i3', 't': 'Why I read on Sunday mornings, phone in the other room', 'at': ago(150)}]
WR_DRAFT = {'kind': 'post', 'title': 'Five blogs I’d hand you',
            'text': "Ben Harlow wrote this week about why he still keeps a blogroll, and Emily Carter called hers a bookshelf by the front door. So here is mine, at last.\n\n"
                    "These are five people I read every week. No app showed them to me. I found every one of them on somebody else’s list, which is exactly how this is meant to work.\n\n"
                    "Sarah Mitchell writes about tomatoes, compost and the people on her street. Her fall garden posts are the best thing in my reader right now.\n\n"
                    "Jake Turner makes small, fast websites and writes about how. Even if you never build one, his posts will change how you see the web.\n\n"
                    "Linda Russo writes down her family’s recipes before they get lost. Start with the bean soup."}
