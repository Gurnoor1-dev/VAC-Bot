require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const PDFDocument = require('pdfkit');

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');


// =====================
// BASIC CONFIG
// =====================

const ALLOWED_ROLE_ID = "1471073279065329785";
const DATA_FILE = path.join(__dirname, 'tickets.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});


// =====================
// LOAD / SAVE JSON
// =====================

let tickets = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        tickets = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch {
        tickets = {};
    }
}

function saveTickets() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}


// =====================
// UTIL FUNCTIONS
// =====================

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

async function generatePDF(data) {
    return new Promise((resolve, reject) => {

        const filePath = path.join(__dirname, `${data.id}.pdf`);
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        // Header Background
        doc.rect(0, 0, doc.page.width, 100).fill('#111827');

        // Header Text
        doc.fillColor('#ffffff')
            .fontSize(24)
            .text("VACompany Order Document", 50, 40);

        doc.moveDown(4);

        // Body
        doc.fillColor('#000000');
        doc.fontSize(16).text(`Order ID: ${data.id}`);
        doc.moveDown();

        doc.fontSize(14).text(`Client Name: ${data.client_name}`);
        doc.text(`Product: ${data.product}`);
        doc.text(`Status: ${data.status}`);

        doc.moveDown(2);

        doc.fontSize(16).text("Client Requests:");
        doc.moveDown();
        doc.fontSize(12).text(data.requests, { width: 500 });

        doc.end();

        stream.on('finish', () => resolve(filePath));
        stream.on('error', reject);
    });
}


// =====================
// REGISTER COMMANDS
// =====================

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o =>
                o.setName('client')
                    .setDescription('Client Name')
                    .setRequired(true))
            .addStringOption(o =>
                o.setName('product')
                    .setDescription('Product')
                    .setRequired(true)
                    .addChoices(
                        { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                        { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                    ))
            .addStringOption(o =>
                o.setName('status')
                    .setDescription('Status')
                    .setRequired(true)
                    .addChoices(
                        { name: 'In Production Phase', value: 'In Production Phase' },
                        { name: 'In Test Phase', value: 'In Test Phase' },
                        { name: 'Handed off to VA for testing', value: 'Handed off to VA for testing' },
                        { name: 'Test Completed', value: 'Test Completed' }
                    ))
            .addStringOption(o =>
                o.setName('requests')
                    .setDescription('Client Requests')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('completeorder')
            .setDescription('Complete order & send document')
            .addStringOption(o =>
                o.setName('id')
                    .setDescription('Order ID')
                    .setRequired(true))
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Client Discord User')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Check status')
            .addStringOption(o =>
                o.setName('id')
                    .setDescription('Order ID')
                    .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("✅ Bot Ready");
});


// =====================
// COMMAND HANDLER
// =====================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {

        // ================= ADD TICKET =================
        if (interaction.commandName === 'addticket') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "❌ No permission.", ephemeral: true });

            const id = generateID(interaction.options.getString('product'));

            tickets[id] = {
                id,
                client_name: interaction.options.getString('client'),
                product: interaction.options.getString('product'),
                status: interaction.options.getString('status'),
                requests: interaction.options.getString('requests')
            };

            saveTickets();

            return interaction.reply({
                content: `✅ Ticket created: **${id}**`,
                ephemeral: true
            });
        }

        // ================= COMPLETE ORDER =================
        if (interaction.commandName === 'completeorder') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "❌ No permission.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            const id = interaction.options.getString('id');
            const user = interaction.options.getUser('user');

            if (!tickets[id])
                return interaction.editReply("❌ Order not found.");

            tickets[id].status = "Processed";
            saveTickets();

            const pdfPath = await generatePDF(tickets[id]);
            const attachment = new AttachmentBuilder(pdfPath);

            await user.send({
                content: "🎉 Your order has been completed. Here is your document:",
                files: [attachment]
            });

            await interaction.editReply("✅ Order completed and document sent.");

            if (fs.existsSync(pdfPath))
                fs.unlinkSync(pdfPath);
        }

        // ================= STATUS =================
        if (interaction.commandName === 'status') {

            const id = interaction.options.getString('id');

            if (!tickets[id])
                return interaction.reply({
                    content: "❌ Product not found, double-check the Order-ID or let an ADMIN know.",
                    ephemeral: true
                });

            const embed = new EmbedBuilder()
                .setTitle("🗃️ Order Status")
                .addFields(
                    { name: "Order ID", value: tickets[id].id },
                    { name: "Name", value: tickets[id].client_name },
                    { name: "Product", value: tickets[id].product },
                    { name: "Status", value: tickets[id].status }
                )
                .setColor("Blue");

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

    } catch (err) {
        console.error("COMMAND ERROR:", err);

        if (interaction.deferred)
            return interaction.editReply("❌ An unexpected error occurred.");
        else
            return interaction.reply({ content: "❌ An unexpected error occurred.", ephemeral: true });
    }
});


// =====================
// LOGIN
// =====================

client.login(process.env.TOKEN);


// =====================
// RAILWAY KEEP-ALIVE SERVER
// =====================

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running');
}).listen(process.env.PORT || 3000);
