
declare module 'mysql' {
	var server: MySql.MySqlModule;

	export = server;
}

declare namespace MySql {
	interface MySqlModule {
		createSQLConnection(connectionUri: string): SQLConnection;
		createSQLConnection(config: SQLConnectionConfig): SQLConnection;
		createPool(config: PoolConfig): Pool;
		createPoolCluster(config?: PoolClusterConfig): PoolCluster;
		escape(value: any): string;
		format(sql: string): string;
		format(sql: string, values: Array<any>): string;
		format(sql: string, values: any): string;
	}

	interface SQLConnectionStatic {
		createSQLQuery(sql: string): SQLQuery;
		createSQLQuery(sql: string, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		createSQLQuery(sql: string, values: Array<any>): SQLQuery;
		createSQLQuery(sql: string, values: Array<any>, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
	}

	interface SQLConnection {
		config: SQLConnectionConfig;

		threadId: number;

		beginTransaction(callback: (err: SQLError) => void): void;

		connect(): void;
		connect(callback: (err: SQLError, ...args: any[]) => void): void;
		connect(options: any, callback?: (err: SQLError, ...args: any[]) => void): void;

		commit(callback: (err: SQLError) => void): void;

		changeUser(options: SQLConnectionOptions): void;
		changeUser(options: SQLConnectionOptions, callback: (err: SQLError) => void): void;

		query: SQLQueryFunction;

		end(): void;
		end(callback: (err: SQLError, ...args: any[]) => void): void;
		end(options: any, callback: (err: SQLError, ...args: any[]) => void): void;

		destroy(): void;

		pause(): void;

		release(): void;
		resume(): void;

		escape(value: any): string;

		escapeId(value: string): string;
		escapeId(values: Array<string>): string;

		format(sql: string): string;
		format(sql: string, values: Array<any>): string;
		format(sql: string, values: any): string;

		on(ev: string, callback: (...args: any[]) => void): SQLConnection;
		on(ev: 'error', callback: (err: SQLError) => void): SQLConnection;

		rollback(callback: () => void): void;
	}

	interface Pool {
		config: PoolConfig;

		getConnection(callback: (err: SQLError, connection: SQLConnection) => void): void;

		query: SQLQueryFunction;

		end(): void;
		end(callback: (err: SQLError, ...args: any[]) => void): void;

		on(ev: string, callback: (...args: any[]) => void): Pool;
		on(ev: 'connection', callback: (connection: SQLConnection) => void): Pool;
		on(ev: 'error', callback: (err: SQLError) => void): Pool;
	}

	interface PoolCluster {
		config: PoolClusterConfig;

		add(config: PoolConfig): void;
		add(group: string, config: PoolConfig): void;

		end(): void;

		getConnection(callback: (err: SQLError, connection: SQLConnection) => void): void;
		getConnection(group: string, callback: (err: SQLError, connection: SQLConnection) => void): void;
		getConnection(group: string, selector: string, callback: (err: SQLError, connection: SQLConnection) => void): void;

		of(pattern: string): Pool;
		of(pattern: string, selector: string): Pool;

		on(ev: string, callback: (...args: any[]) => void): PoolCluster;
		on(ev: 'remove', callback: (nodeId: number) => void): PoolCluster;
		on(ev: 'connection', callback: (connection: SQLConnection) => void): PoolCluster;
		on(ev: 'error', callback: (err: SQLError) => void): PoolCluster;
	}

	interface SQLQuery {
		/**
		 * The SQL for a constructed query
		 */
		sql: string;

		/**
		 * Emits a query packet to start the query
		 */
		start(): void;

		/**
		 * Determines the packet class to use given the first byte of the packet.
		 *
		 * @param firstByte The first byte of the packet
		 * @param parser The packet parser
		 */
		determinePacket(firstByte: number, parser: any): any;


		/**
		 * Pipes a stream downstream, providing automatic pause/resume based on the
		 * options sent to the stream.
		 *
		 * @param options The options for the stream.
		 */
		pipe(callback: (...args: any[]) => void): SQLQuery;

		on(ev: string, callback: (...args: any[]) => void): SQLQuery;
		on(ev: 'error', callback: (err: SQLError) => void): SQLQuery;
		on(ev: 'fields', callback: (fields: any, index: number) => void): SQLQuery;
		on(ev: 'result', callback: (row: any, index: number) => void): SQLQuery;
		on(ev: 'end', callback: () => void): SQLQuery;
	}

	interface SQLQueryFunction {
		(sql: string): SQLQuery;
		(sql: string, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		(sql: string, values: Array<any>): SQLQuery;
		(sql: string, values: Array<any>, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		(sql: string, values: any): SQLQuery;
		(sql: string, values: any, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		(options: SQLQueryOptions): SQLQuery;
		(options: SQLQueryOptions, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		(options: SQLQueryOptions, values: Array<any>): SQLQuery;
		(options: SQLQueryOptions, values: Array<any>, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
		(options: SQLQueryOptions, values: any): SQLQuery;
		(options: SQLQueryOptions, values: any, callback: (err: SQLError, ...args: any[]) => void): SQLQuery;
	}

	interface SQLQueryOptions {
		/**
		 * The SQL for the query
		 */
		sql: string;

		/**
		 * Every operation takes an optional inactivity timeout option. This allows you to specify appropriate timeouts for
		 * operations. It is important to note that these timeouts are not part of the MySQL protocol, and rather timeout
		 * operations through the client. This means that when a timeout is reached, the connection it occurred on will be
		 * destroyed and no further operations can be performed.
		 */
		timeout?: number;

		/**
		 * Either a boolean or string. If true, tables will be nested objects. If string (e.g. '_'), tables will be
		 * nested as tableName_fieldName
		 */
		nestTables?: any;

		/**
		 * Determines if column values should be converted to native JavaScript types. It is not recommended (and may go away / change in the future)
		 * to disable type casting, but you can currently do so on either the connection or query level. (Default: true)
		 *
		 * You can also specify a function (field: any, next: () => void) => {} to do the type casting yourself.
		 *
		 * WARNING: YOU MUST INVOKE the parser using one of these three field functions in your custom typeCast callback. They can only be called once.
		 *
		 * field.string()
		 * field.buffer()
		 * field.geometry()
		 *
		 * are aliases for
		 *
		 * parser.parseLengthCodedString()
		 * parser.parseLengthCodedBuffer()
		 * parser.parseGeometryValue()
		 *
		 * You can find which field function you need to use by looking at: RowDataPacket.prototype._typeCast
		 */
		typeCast?: any;
	}

	interface StreamOptions {
		/**
		 * Sets the max buffer size in objects of a stream
		 */
		highWaterMark?: number;

		/**
		 * The object mode of the stream (Default: true)
		 */
		objectMode?: any;
	}

	interface SQLConnectionOptions {
		/**
		 * The MySQL user to authenticate as
		 */
		user?: string;

		/**
		 * The password of that MySQL user
		 */
		password?: string;

		/**
		 * Name of the database to use for this connection
		 */
		database?: string;

		/**
		 * The charset for the connection. This is called "collation" in the SQL-level of MySQL (like utf8_general_ci).
		 * If a SQL-level charset is specified (like utf8mb4) then the default collation for that charset is used.
		 * (Default: 'UTF8_GENERAL_CI')
		 */
		charset?: string;
	}

	interface SQLConnectionConfig extends SQLConnectionOptions {
		/**
		 * The hostname of the database you are connecting to. (Default: localhost)
		 */
		host?: string;

		/**
		 * The port number to connect to. (Default: 3306)
		 */
		port?: number;

		/**
		 * The source IP address to use for TCP connection
		 */
		localAddress?: string;

		/**
		 * The path to a unix domain socket to connect to. When used host and port are ignored
		 */
		socketPath?: string;

		/**
		 * The timezone used to store local dates. (Default: 'local')
		 */
		timezone?: string;

		/**
		 * The milliseconds before a timeout occurs during the initial connection to the MySQL server. (Default: 10 seconds)
		 */
		connectTimeout?: number;

		/**
		 * Stringify objects instead of converting to values. (Default: 'false')
		 */
		stringifyObjects?: boolean;

		/**
		 * Allow connecting to MySQL instances that ask for the old (insecure) authentication method. (Default: false)
		 */
		insecureAuth?: boolean;

		/**
		 * Determines if column values should be converted to native JavaScript types. It is not recommended (and may go away / change in the future)
		 * to disable type casting, but you can currently do so on either the connection or query level. (Default: true)
		 *
		 * You can also specify a function (field: any, next: () => void) => {} to do the type casting yourself.
		 *
		 * WARNING: YOU MUST INVOKE the parser using one of these three field functions in your custom typeCast callback. They can only be called once.
		 *
		 * field.string()
		 * field.buffer()
		 * field.geometry()
		 *
		 * are aliases for
		 *
		 * parser.parseLengthCodedString()
		 * parser.parseLengthCodedBuffer()
		 * parser.parseGeometryValue()
		 *
		 * You can find which field function you need to use by looking at: RowDataPacket.prototype._typeCast
		 */
		typeCast?: any;

		/**
		 * A custom query format function
		 */
		queryFormat?: (query: string, values: any) => void;

		/**
		 * When dealing with big numbers (BIGINT and DECIMAL columns) in the database, you should enable this option
		 * (Default: false)
		 */
		supportBigNumbers?: boolean;

		/**
		 * Enabling both supportBigNumbers and bigNumberStrings forces big numbers (BIGINT and DECIMAL columns) to be
		 * always returned as JavaScript String objects (Default: false). Enabling supportBigNumbers but leaving
		 * bigNumberStrings disabled will return big numbers as String objects only when they cannot be accurately
		 * represented with [JavaScript Number objects] (http://ecma262-5.com/ELS5_HTML.htm#Section_8.5)
		 * (which happens when they exceed the [-2^53, +2^53] range), otherwise they will be returned as Number objects.
		 * This option is ignored if supportBigNumbers is disabled.
		 */
		bigNumberStrings?: boolean;

		/**
		 * Force date types (TIMESTAMP, DATETIME, DATE) to be returned as strings rather then inflated into JavaScript Date
		 * objects. (Default: false)
		 */
		dateStrings?: boolean;

		/**
		 * This will print all incoming and outgoing packets on stdout.
		 * You can also restrict debugging to packet types by passing an array of types (strings) to debug;
		 *
		 * (Default: false)
		 */
		debug?: any;

		/**
		 * Generates stack traces on Error to include call site of library entrance ("long stack traces"). Slight
		 * performance penalty for most calls. (Default: true)
		 */
		trace?: boolean;

		/**
		 * Allow multiple mysql statements per query. Be careful with this, it exposes you to SQL injection attacks. (Default: false)
		 */
		multipleStatements?: boolean;

		/**
		 * List of connection flags to use other than the default ones. It is also possible to blacklist default ones
		 */
		flags?: Array<string>;

		/**
		 * object with ssl parameters or a string containing name of ssl profile
		 */
		ssl?: any;
	}

	interface PoolConfig extends SQLConnectionConfig {
		/**
		 * The milliseconds before a timeout occurs during the connection acquisition. This is slightly different from connectTimeout,
		 * because acquiring a pool connection does not always involve making a connection. (Default: 10 seconds)
		 */
		acquireTimeout?: number;

		/**
		 * Determines the pool's action when no connections are available and the limit has been reached. If true, the pool will queue
		 * the connection request and call it when one becomes available. If false, the pool will immediately call back with an error.
		 * (Default: true)
		 */
		waitForSQLConnections?: boolean;

		/**
		 * The maximum number of connections to create at once. (Default: 10)
		 */
		connectionLimit?: number;

		/**
		 * The maximum number of connection requests the pool will queue before returning an error from getConnection. If set to 0, there
		 * is no limit to the number of queued connection requests. (Default: 0)
		 */
		queueLimit?: number;
	}

	interface PoolClusterConfig {
		/**
		 * If true, PoolCluster will attempt to reconnect when connection fails. (Default: true)
		 */
		canRetry?: boolean;

		/**
		 * If connection fails, node's errorCount increases. When errorCount is greater than removeNodeErrorCount,
		 * remove a node in the PoolCluster. (Default: 5)
		 */
		removeNodeErrorCount?: number;

		/**
		 * If connection fails, specifies the number of milliseconds before another connection attempt will be made.
		 * If set to 0, then node will be removed instead and never re-used. (Default: 0)
		 */
		restoreNodeTimeout?: number;

		/**
		 * The default selector. (Default: RR)
		 * RR: Select one alternately. (Round-Robin)
		 * RANDOM: Select the node by random function.
		 * ORDER: Select the first node available unconditionally.
		 */
		defaultSelector?: string;
	}

	interface SslCredentials {
		/**
		 * A string or buffer holding the PFX or PKCS12 encoded private key, certificate and CA certificates
		 */
		pfx?: string;

		/**
		 * A string holding the PEM encoded private key
		 */
		key?: string;

		/**
		 * A string of passphrase for the private key or pfx
		 */
		passphrase?: string;

		/**
		 * A string holding the PEM encoded certificate
		 */
		cert?: string;

		/**
		 * Either a string or list of strings of PEM encoded CA certificates to trust.
		 */
		ca?: Array<string>;

		/**
		 * Either a string or list of strings of PEM encoded CRLs (Certificate Revocation List)
		 */
		crl?: Array<string>;

		/**
		 * A string describing the ciphers to use or exclude
		 */
		ciphers?: string;
	}

	interface SQLError extends Error {
		/**
		 * Either a MySQL server error (e.g. 'ER_ACCESS_DENIED_ERROR'),
		 * a node.js error (e.g. 'ECONNREFUSED') or an internal error
		 * (e.g. 'PROTOCOL_CONNECTION_LOST').
		 */
		code: string;

		/**
		 * The error number for the error code
		 */
		errno: number;

		/**
		 * The sql state marker
		 */
		sqlStateMarker?: string;

		/**
		 * The sql state
		 */
		sqlState?: string;

		/**
		 * The field count
		 */
		fieldCount?: number;

		/**
		 * The stack trace for the error
		 */
		stack?: string;

		/**
		 * Boolean, indicating if this error is terminal to the connection object.
		 */
		fatal: boolean;
	}
}
