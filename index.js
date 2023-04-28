const {CookieJar, Cookie} = require('tough-cookie')
const got = require('got')
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2);

//deezer-js
class Deezer{
  constructor(){
	this.http_headers = {
	  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36"
	}
	this.cookie_jar = new CookieJar()

	this.logged_in = false
	this.current_user = {}
	this.childs = []
	this.selected_account = 0

	this.gw = new GW(this.cookie_jar, this.http_headers)
  }

  async login(email, password, re_captcha_token, child=0){
	if (child) child = parseInt(child)
	// Check if user already logged in
	let user_data = await this.gw.get_user_data()
	if (!user_data || user_data && Object.keys(user_data).length === 0) return this.logged_in = false
	if (user_data.USER.USER_ID == 0) return this.logged_in = false
	// Get the checkFormLogin
	let check_form_login = user_data.checkFormLogin
	let login = await got.post("https://www.deezer.com/ajax/action.php", {
	  headers: this.http_headers,
	  cookieJar: this.cookie_jar,
	  https: {
		rejectUnauthorized: false
	  },
	  form:{
		  type: 'login',
		  mail: email,
		  password: password,
		  checkFormLogin: check_form_login,
		  reCaptchaToken: re_captcha_token
	  }
	}).text()
	// Check if user logged in
	if (login.text.indexOf('success') == -1){
	  this.logged_in = false
	  return false
	}
	user_data = await this.gw.get_user_data()
	await this._post_login(user_data)
	this.change_account(child)
	this.logged_in = true
	return true
  }

  async login_via_arl(arl, child=0){
	arl = arl.trim()
	if (child) child = parseInt(child)
	// Create cookie
	let cookie_obj = new Cookie({
	  key: 'arl',
	  value: arl,
	  domain: '.deezer.com',
	  path: "/",
	  httpOnly: true
	})
	await this.cookie_jar.setCookie(cookie_obj.toString(), "https://www.deezer.com")

	let user_data = await this.gw.get_user_data()
	// Check if user logged in
	if (!user_data || user_data && Object.keys(user_data).length === 0) return this.logged_in = false
	if (user_data.USER.USER_ID == 0) return this.logged_in = false

	await this._post_login(user_data)
	this.change_account(child)
	this.logged_in = true
	return true
  }

  async _post_login(user_data){
	this.childs = []
	let family = user_data.USER.MULTI_ACCOUNT.ENABLED && !user_data.USER.MULTI_ACCOUNT.IS_SUB_ACCOUNT
	if (family){
	  let childs = await this.gw.get_child_accounts()
	  childs.forEach(child => {
		if (child.EXTRA_FAMILY.IS_LOGGABLE_AS) {
		  this.childs.push({
			'id': child.USER_ID,
			'name': child.BLOG_NAME,
			'picture': child.USER_PICTURE || "",
			'license_token': user_data.USER.OPTIONS.license_token,
			'can_stream_hq': user_data.USER.OPTIONS.web_hq || user_data.USER.OPTIONS.mobile_hq,
			'can_stream_lossless': user_data.USER.OPTIONS.web_lossless || user_data.USER.OPTIONS.mobile_lossless,
			'country': user_data.USER.OPTIONS.license_country,
			'language': user_data.USER.SETTING.global.language || "",
			'loved_tracks': child.LOVEDTRACKS_ID
		  })
		}
	  })
	} else {
	  this.childs.push({
		'id': user_data.USER.USER_ID,
		'name': user_data.USER.BLOG_NAME,
		'picture': user_data.USER.USER_PICTURE || "",
		'license_token': user_data.USER.OPTIONS.license_token,
		'can_stream_hq': user_data.USER.OPTIONS.web_hq || user_data.USER.OPTIONS.mobile_hq,
		'can_stream_lossless': user_data.USER.OPTIONS.web_lossless || user_data.USER.OPTIONS.mobile_lossless,
		'country': user_data.USER.OPTIONS.license_country,
		'language': user_data.USER.SETTING.global.language || "",
		'loved_tracks': user_data.USER.LOVEDTRACKS_ID
	  })
	}
  }

  change_account(child_n){
	if (this.childs.length-1 < child_n) child_n = 0
	this.current_user = this.childs[child_n]
	this.selected_account = child_n
	let lang = this.current_user.language.toString().replace(/[^0-9A-Za-z *,-.;=]/g, '')
	if (lang.slice(2,1) == '-')
	  lang = lang.slice(0,5)
	else
	  lang = lang.slice(0,2)
	this.http_headers["Accept-Language"] = lang

	return [this.current_user, this.selected_account]
  }

  async get_track_url(track_token, format) {
	let tracks = await this.get_tracks_url([track_token, ], format)
	if (tracks.length > 0){
	  if (tracks[0] instanceof DeezerError) throw tracks[0]
	  else return tracks[0]
	}
	return null
  }

  async get_tracks_url(track_tokens, format){
	if (!Array.isArray(track_tokens)) track_tokens = [track_tokens, ]
	if (!this.current_user.license_token) return []
	if (
	  (format === "FLAC" || format.startsWith("MP4_RA")) && !this.current_user.can_stream_lossless ||
	  format === "MP3_320" && !this.current_user.can_stream_hq
	) throw new WrongLicense(format)

	let response
	let result = []

	try {
	  response = await got.post("https://media.deezer.com/v1/get_url", {
		headers: this.http_headers,
		cookieJar: this.cookie_jar,
		https: {
					rejectUnauthorized: false
				},
		json: {
		  license_token: this.current_user.license_token,
		  media: [{
			type: "FULL",
			formats: [{ cipher: "BF_CBC_STRIPE", format: format }]
		  }],
		  track_tokens
		}
	  }).json()
	} catch (e){
	  return []
	}

	if (response.data.length){
	  response.data.forEach(data =>{
		if (data.errors){
		  if (data.errors[0].code === 2002){
			result.push(new WrongGeolocation(this.current_user.country))
		  }else {
			result.push(new DeezerError(JSON.stringify(response)))
		  }
		}
		if (data.media) result.push(data.media[0].sources[0].url)
		else result.push(null)
	  })
	}
	return result
  }
}


class GW{
  constructor(cookie_jar, headers){
	this.http_headers = headers
	this.cookie_jar = cookie_jar
	this.api_token = null
  }

  async api_call(method, args, params){
	if (typeof args === undefined) args = {}
	if (typeof params === undefined) params = {}
	if (!this.api_token && method != 'deezer.getUserData') this.api_token = await this._get_token()
	let p = {
	  api_version: "1.0",
	  api_token: method == 'deezer.getUserData' ? 'null' : this.api_token,
	  input: '3',
	  method: method,
	  ...params
	}
	let result_json
	try{
	  result_json = await got.post("http://www.deezer.com/ajax/gw-light.php", {
		searchParams: p,
		json: args,
		cookieJar: this.cookie_jar,
		headers: this.http_headers,
		https: {
					rejectUnauthorized: false
				},
		timeout: 30000
	  }).json()
	}catch (e){
	  console.debug("[ERROR] deezer.gw", method, args, e.name, e.message)
	  if (["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETRESET", "ETIMEDOUT"].includes(e.code)){
		await new Promise(r => setTimeout(r, 2000)) // sleep(2000ms)
		return this.api_call(method, args, params)
	  }
	  throw new GWAPIError(`${method} ${args}:: ${e.name}: ${e.message}`)
	}
	if (result_json.error.length || Object.keys(result_json.error).length) {
	  if (
		JSON.stringify(result_json.error) == '{"GATEWAY_ERROR":"invalid api token"}' ||
		JSON.stringify(result_json.error) == '{"VALID_TOKEN_REQUIRED":"Invalid CSRF token"}'
	  ){
		this.api_token = await this._get_token()
		return this.api_call(method, args, params)
	  }
	  if (result_json.payload && result_json.payload.FALLBACK){
		Object.keys(result_json.payload.FALLBACK).forEach(key => {
		  args[key] = result_json.payload.FALLBACK[key]
		})
		return this.api_call(method, args, params)
	  }
	  throw new GWAPIError(JSON.stringify(result_json.error))
	}
	if (!this.api_token && method == 'deezer.getUserData') this.api_token = result_json.results.checkForm
	return result_json.results
  }
  
  async _get_token(){
	  let token_data = await this.get_user_data()
	  return token_data.checkForm
	}
	
	get_user_data(){
		return this.api_call('deezer.getUserData')
	  }
  
  get_track_lyrics(sng_id){
	return this.api_call('song.getLyrics', {SNG_ID: sng_id})
  }
}

class DeezerError extends Error {
  constructor(message) {
	super(message)
	this.name = "DeezerError"
  }
}

class WrongLicense extends DeezerError {
  constructor(format) {
	super()
	this.name = "WrongLicense"
	this.message = `Your account can't request urls for ${format} tracks`
	this.format = format
  }
}

class WrongGeolocation extends DeezerError {
  constructor(country) {
	super()
	this.name = "WrongGeolocation"
	this.message = `The track you requested can't be streamed in country ${country}`
	this.country = country
  }
}

// APIError
class APIError extends DeezerError {
  constructor(message) {
	super(message);
	this.name = "APIError";
  }
}
class ItemsLimitExceededException extends APIError {
  constructor(message) {
	super(message);
	this.name = "ItemsLimitExceededException";
  }
}
class PermissionException extends APIError {
  constructor(message) {
	super(message);
	this.name = "PermissionException";
  }
}
class InvalidTokenException extends APIError {
  constructor(message) {
	super(message);
	this.name = "InvalidTokenException";
  }
}
class WrongParameterException extends APIError {
  constructor(message) {
	super(message);
	this.name = "WrongParameterException";
  }
}
class MissingParameterException extends APIError {
  constructor(message) {
	super(message);
	this.name = "MissingParameterException";
  }
}
class InvalidQueryException extends APIError {
  constructor(message) {
	super(message);
	this.name = "InvalidQueryException";
  }
}
class DataException extends APIError {
  constructor(message) {
	super(message);
	this.name = "DataException";
  }
}
class IndividualAccountChangedNotAllowedException extends APIError {
  constructor(message) {
	super(message);
	this.name = "IndividualAccountChangedNotAllowedException";
  }
}
class GWAPIError extends DeezerError {
  constructor(message) {
	super(message);
	this.name = "GWAPIError";
  }
}

async function generateLrc(sng) {
	let dz = new Deezer()
	var res = ""
	let data = await dz.gw.get_track_lyrics(sng)
	for (var i = 0; i < data.LYRICS_SYNC_JSON.length; i+=1) {
		if (data.LYRICS_SYNC_JSON[i].line != "") {
			res += data.LYRICS_SYNC_JSON[i].lrc_timestamp + data.LYRICS_SYNC_JSON[i].line + "\n"
		}
	}
	fs.writeFile(path.join(__dirname,sng + '.lrc'), res, (err) => {
	  if (err) throw err;
	});
}

module.exports = generateLrc

if (args[0]) {
	generateLrc(args[0])
} else {
	console.warn("Error : Missing parameters !")
}
