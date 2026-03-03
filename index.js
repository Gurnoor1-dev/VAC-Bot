require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
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

const ALLOWED_ROLE_ID = "1471073279065329785";
const DATA_FILE = path.join(__dirname, 'tickets.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

// ================= LOAD JSON =================

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

// ================= UTIL =================

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', err => {
            fs.unlink(filepath, () => {});
            reject(err);
        });
    });
}

function convertToPDF(imagePath, pdfPath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ autoFirstPage: false });
        const stream = fs.createWriteStream(pdfPath);

        doc.pipe(stream);

        const img = doc.openImage(imagePath);

        doc.addPage({
            size: [img.width, img.height]
        });

        doc.image(imagePath, 0, 0);
        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

// ================= REGISTER COMMANDS =================

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o =>
                o.setName('client').setDescription('Client Name').setRequired(true))
            .addStringOption(o =>
                o.setName('product').setDescription('Product').setRequired(true)
                    .addChoices(
                        { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                        { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                    ))
            .addStringOption(o =>
                o.setName('status').setDescription('Status').setRequired(true)
                    .addChoices(
                        { name: 'In Production Phase', value: 'In Production Phase' },
                        { name: 'In Test Phase', value: 'In Test Phase' },
                        { name: 'Handed off to VA for testing', value: 'Handed off to VA for testing' },
                        { name: 'Test Completed', value: 'Test Completed' }
                    ))
            .addStringOption(o =>
                o.setName('requests').setDescription('Client Requests').setRequired(true))
            .addStringOption(o =>
                o.setName('representative_1').setDescription('Main Representative').setRequired(true))
            .addStringOption(o =>
                o.setName('representative_2').setDescription('Second Representative (optional)').setRequired(false))
            .addStringOption(o =>
                o.setName('ticket_id').setDescription('Custom Ticket ID (optional)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('completeorder')
            .setDescription('Complete order & send PDF')
            .addStringOption(o =>
                o.setName('id').setDescription('Order ID').setRequired(true))
            .addUserOption(o =>
                o.setName('user').setDescription('Client Discord User').setRequired(true))
            .addStringOption(o =>
                o.setName('png_link').setDescription('Direct PNG link').setRequired(true)),

        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Check status')
            .addStringOption(o =>
                o.setName('id').setDescription('Order ID').setRequired(true)),

        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Send public status panel')
            .addStringOption(o =>
                o.setName('id').setDescription('Order ID').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("✅ Bot Ready");
});

// ================= COMMAND HANDLER =================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {

        // ================= ADD TICKET =================
        if (interaction.commandName === 'addticket') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "❌ No permission.", ephemeral: true });

            const customID = interaction.options.getString('ticket_id');
            let id;

            if (customID && customID.trim() !== "") {
                id = customID.toLowerCase();
                if (tickets[id]) {
                    return interaction.reply({
                        content: "❌ This Ticket-ID already exists.",
                        ephemeral: true
                    });
                }
            } else {
                id = generateID(interaction.options.getString('product'));
            }

            tickets[id] = {
                id,
                client_name: interaction.options.getString('client'),
                product: interaction.options.getString('product'),
                status: interaction.options.getString('status'),
                requests: interaction.options.getString('requests'),
                representative_1: interaction.options.getString('representative_1'),
                representative_2: interaction.options.getString('representative_2') || null,
                last_updated: Date.now()
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
            const pngLink = interaction.options.getString('png_link');

            if (!tickets[id])
                return interaction.editReply("❌ Order not found.");

            tickets[id].status = "Processed";
            tickets[id].last_updated = Date.now();
            saveTickets();

            const imagePath = path.join(__dirname, `${id}.png`);
            const pdfPath = path.join(__dirname, `${id}.pdf`);

            await downloadImage(pngLink, imagePath);
            await convertToPDF(imagePath, pdfPath);

            const attachment = new AttachmentBuilder(pdfPath);

            await user.send({
                content: "🎉 Your order has been completed. Here is your PDF:",
                files: [attachment]
            });

            await interaction.editReply("✅ PDF generated and sent.");

            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        }

        // ================= STATUS =================
        if (interaction.commandName === 'status') {

            const id = interaction.options.getString('id');

            if (!tickets[id])
                return interaction.reply({
                    content: "❌ Product not found.",
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

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // ================= PANEL =================
        if (interaction.commandName === 'panel') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "❌ No permission.", ephemeral: true });

            const id = interaction.options.getString('id');

            if (!tickets[id])
                return interaction.reply({ content: "❌ Order not found.", ephemeral: true });

            const ticket = tickets[id];

            const representatives = ticket.representative_2
                ? `${ticket.representative_1}\n${ticket.representative_2}`
                : ticket.representative_1;

            const embed = new EmbedBuilder()
                .setTitle(`🌐 Status - ${ticket.representative_1}`)
                .addFields(
                    { name: "👨🏻‍✈️ Representatives:", value: representatives },
                    { name: "🗃️ Client:", value: ticket.client_name },
                    { name: "💳 Product:", value: ticket.product },
                    { name: "📊 Status:", value: ticket.status },
                    { name: "⏱️ Last Updated:", value: `<t:${Math.floor(ticket.last_updated / 1000)}:F>` }
                )
                .setFooter({
                    text: `VACompany | ${ticket.product.includes("Polaris") ? "Polaris™" : "Tracker™"}`
                })
                .setColor("Green");

            return interaction.reply({ embeds: [embed] });
        }

    } catch (err) {
        console.error(err);
        if (interaction.deferred)
            interaction.editReply("❌ Error occurred.");
        else
            interaction.reply({ content: "❌ Error occurred.", ephemeral: true });
    }
});

client.login(process.env.TOKEN);

// Railway Keep Alive
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running");
}).listen(process.env.PORT || 3000);
