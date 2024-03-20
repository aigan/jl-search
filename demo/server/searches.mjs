import Https from 'node:https';
import Mysql from 'mysql2/promise';
import FS from 'node:fs';

const port = 9071;

// Needs to be large enough to offset the number of filtered out
// sequential duplicates, in relation to the requestors default page
// size.
const limit_max = 21;

const log = console.log.bind(console);

const DB = await Mysql.createConnection({user:'guest', database:'enwiki'});

const routes = {
	"/s/": on_search,
}

const headers = {
	"Content-Type": "application/json; charset=utf-8",
	"Access-Control-Allow-Origin": "*",
}

function requestListener(req, res) {
	const state = {req,res};
	for( const [route, handler] of Object.entries(routes) ){
		if( req.url.startsWith(route) )
			return handler( state, req.url.substring( route.length) )
			.catch(err=>send_answer_fail(state, err))
	}
	log("404 for", req.url);
	res.writeHead(404, headers);
	res.end('{"error":{"name":"404","message":"Not found"}}');
}

async function on_search( state, subpath ){
	const [query_raw, options_raw] = subpath.split('?');
	const options = new URLSearchParams(options_raw);
	const q = state.query = decodeURIComponent(query_raw);
	if( q.length < 1 ) return send_answer_fail(state, 'Too short');

	if( q === "trigger_error" ) await DB.query("select in 'stupid mistake'");

	/*
		In the interest of a good first impression, use another strategy
		for the first two letters for optimal search speed.
	 */
	
	let calc_found_prefix, cnt_sql;
	if( q.length < 3 ){
		calc_found_prefix = "";
		cnt_sql = "select row_count as cnt from prefix_counts where prefix=?";
	} else {
		calc_found_prefix = "SQL_CALC_FOUND_ROWS";
		cnt_sql = "SELECT FOUND_ROWS() as cnt";
	}
	
	const q_pat = q.replaceAll(/[%_\\]/g, char=>"\\"+char);
	const [res_pages, res_found] = await Promise.all([
		DB.query(`
SELECT ${calc_found_prefix} title_se, title_rd
FROM page
WHERE title_se like ? and is_disambiguation is false
ORDER BY title_se
LIMIT ?
`, [q_pat+'%', limit_max]),
		DB.query(cnt_sql, [q.slice(0,1)]),
	]);

	const found = [];
	const count = res_found[0][0].cnt;

	// Group adjacent titles for same page. Prefer redirect if it's one of them.

	let previous_title = "";
	let previous_redirect = "";
	
	for( const row of res_pages[0] ){
//		if( count < 5 ) log("Consider", row);

		const title_se = row.title_se;
		let title_rd = row.title_rd ?? title_se;

		if( title_rd !== previous_redirect ){
			if( previous_title.length ) found.push( previous_title );

			previous_redirect = title_rd;
			previous_title = title_se;
		}
		else{
			if( title_rd === title_se ) previous_title = title_se;
		}
	}

	if( previous_title.length ) found.push( previous_title );

	
	log('query', q, options, count);
//	if( count < 5 ) log(found);
	if( options.has('delay') ){
		const delay = parseFloat(options.get('delay')) || 333;
		await sleep( Math.max(5-q.length,1) * delay );
	}
	
	send_answer(state, {count,found})
}

function send_answer( {res,query}, data_in ){
	const data = { query, ...data_in };
	res.writeHead(200, headers );
	res.end( JSON.stringify( data) );
}

function send_answer_fail( state, err_in ){
	const error = {
		name: "Error",
		message: "unknown",
	}

	if( typeof err_in === 'string' ) error.message = err_in;
	else {
		Object.getOwnPropertyNames(err_in).forEach( key =>{
			error[key] = err_in[key];
		})
	}

	send_answer( state, {error});
}


const keys = "/etc/letsencrypt/live/wiki.para.se/";
const options = {
  key: FS.readFileSync(keys+'privkey.pem'),
  cert: FS.readFileSync(keys+'fullchain.pem'),
};

const server = Https.createServer(options, requestListener);
server.listen( port, ()=>{
	log(`Listening on ${port}`)
})

function sleep( time ){
	return new Promise( resolve => setTimeout( resolve, time ) );
}

async function ping_db() {
	try {
		await DB.query("SELECT 1");
		//log('Ping-pong');
	} catch( err ){
		console.warn(err);
	}
}
setInterval(ping_db, 50000);


/*
	CREATE USER 'guest'@'localhost' WITH max_queries_per_hour 1000 max_user_connections 5;
	GRANT SELECT ON enwiki.* TO 'guest'@'localhost';

	ALTER DATABASE enwiki CHARACTER SET = 'utf8mb4' COLLATE = 'utf8mb4_swedish_ci';
	ALTER TABLE page CONVERT TO CHARACTER SET 'utf8mb4' COLLATE 'utf8mb4_swedish_ci';


	### title_se
	ALTER TABLE page ADD COLUMN title_se VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci;
	ALTER TABLE page ADD INDEX (title_se);
	UPDATE page SET title_se = CONVERT(page_title USING utf8mb4) WHERE title_se is null LIMIT 10000;

	### title_rd
	ALTER TABLE page ADD COLUMN title_rd varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci;
	UPDATE page JOIN redirect ON page_id = rd_from SET title_rd = title_rd;

	
	### disambiguation
	ALTER TABLE page ADD COLUMN is_disambiguation BOOLEAN DEFAULT false;
	ALTER TABLE page ADD INDEX (title_se, is_disambiguation );

  UPDATE page LEFT JOIN page_props ON page_id=pp_page AND pp_propname = 'disambiguation' SET is_disambiguation=true WHERE pp_propname="disambiguation";

	UPDATE page as p1 JOIN page as p2 ON p1.title_rd=p2.title_se SET p1.is_disambiguation = TRUE	WHERE p2.is_disambiguation AND p1.title_rd IS NOT NULL;
	
	
	select title_se from page where title_se like 'and%' order by title_se limit 20;


	CREATE TABLE prefix_counts ( prefix VARCHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci, row_count INT, PRIMARY KEY (prefix) );

	INSERT INTO prefix_counts (prefix, row_count)
	SELECT DISTINCT UPPER(LEFT(title_se, 1)) AS prefix, COUNT(*) AS row_count FROM page GROUP BY UPPER(LEFT(title_se, 1));

	INSERT IGNORE INTO prefix_counts (prefix, row_count)
	SELECT DISTINCT UPPER(LEFT(title_se, 2) COLLATE utf8mb4_swedish_ci ) AS prefix, COUNT(*) AS row_count
	FROM page GROUP BY UPPER(LEFT(title_se, 2) COLLATE utf8mb4_swedish_ci );

		
*/

